/**
 * 极简 .xlsx 读写。
 *
 * 只支持扩展需要的子集：纯文本单元格、单行表头、无公式、无合并单元格。
 * 读取：解压 ZIP → 定位工作表 → 扫描 `<c>` 单元格（共享字符串 / 内联字符串 / 数值）。
 * 写入：拼装最小 xlsx 骨架（内联字符串 + 文本格式 + 冻结表头），不引入 xlsx 写库。
 *
 * 该模块不依赖 React、chrome 与 DOM，可在 node --test 中直接运行。
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** 单元格读取结果。`numeric` 为 true 表示 Excel 以数值存储，用于识别被转成数字的凭据。 */
export function cell(value, numeric = false) {
  return { value, numeric };
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error("无法解析文件内容");
}

function decodeXml(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function attrs(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:]+)="([^"]*)"/g)) result[match[1]] = decodeXml(match[2]);
  return result;
}

function textNodes(fragment) {
  return [...fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("");
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
    strings.push(match[1] ? textNodes(match[1]) : "");
  }
  return strings;
}

function parseSheetTargets(relsXml) {
  const targets = new Map();
  if (!relsXml) return targets;
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const item = attrs(match[0]);
    if (item.Id && item.Target) targets.set(item.Id, item.Target);
  }
  return targets;
}

function resolvePartPath(target) {
  const clean = String(target).replace(/^\/+/, "");
  return clean.startsWith("xl/") ? clean : `xl/${clean}`;
}

function columnIndex(ref) {
  const letters = String(ref).replace(/[^A-Za-z]/g, "").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function parseSheet(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowAttrs = attrs(rowMatch[1]);
    const rowNumber = Number(rowAttrs.r || rows.length + 1) - 1;
    const cells = [];
    for (const cellMatch of (rowMatch[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellAttrs = attrs(cellMatch[1]);
      const body = cellMatch[2] || "";
      const index = columnIndex(cellAttrs.r || `${columnName(cells.length)}1`);
      let value = "";
      let numeric = false;
      if (cellAttrs.t === "s") {
        const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        const position = raw ? Number(decodeXml(raw[1])) : -1;
        value = sharedStrings[position] ?? "";
      } else if (cellAttrs.t === "inlineStr") {
        const inline = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
        value = textNodes(inline ? inline[1] : body);
      } else if (cellAttrs.t === "str" || cellAttrs.t === "d" || cellAttrs.t === "e") {
        const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        value = raw ? decodeXml(raw[1]) : "";
      } else if (cellAttrs.t === "b") {
        const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        value = raw && decodeXml(raw[1]) === "1" ? "TRUE" : "FALSE";
      } else {
        const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        if (raw) {
          value = decodeXml(raw[1]);
          numeric = true;
        }
      }
      cells[index] = cell(value, numeric);
    }
    rows[rowNumber] = cells;
  }

  const width = rows.reduce((max, row) => Math.max(max, (row || []).length), 0);
  return rows.map((row) => Array.from({ length: width }, (_, index) => row?.[index] || cell("")));
}

function columnName(index) {
  let name = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

/** 读取工作簿全部工作表：`[{ name, rows }]`，rows 为 `{ value, numeric }` 二维数组。 */
export function readSheets(input) {
  const bytes = toBytes(input);
  let files;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("无法读取该文件，请确认它是 .xlsx 格式且未损坏");
  }
  const workbookXml = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  if (!workbookXml) throw new Error("该文件不是有效的 Excel 工作簿（缺少 xl/workbook.xml）");
  const sharedStrings = parseSharedStrings(files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : "");
  const targets = parseSheetTargets(files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : "");
  const sheets = [];
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const item = attrs(match[0]);
    const part = targets.get(item["r:id"]);
    const path = part ? resolvePartPath(part) : `xl/worksheets/sheet${item.sheetId || sheets.length + 1}.xml`;
    const xml = files[path] ? strFromU8(files[path]) : "";
    sheets.push({ name: String(item.name || `Sheet${sheets.length + 1}`), rows: xml ? parseSheet(xml, sharedStrings) : [] });
  }
  if (!sheets.length) throw new Error("该文件中没有可读取的工作表");
  return sheets;
}

/** 按工作表名（忽略大小写与空格）挑选；跳过“说明”类工作表；找不到则取第一张。 */
export function pickSheet(sheets, preferred = []) {
  const keys = preferred.map((name) => String(name).replace(/\s+/g, "").toLowerCase());
  const found = sheets.find((sheet) => keys.includes(String(sheet.name).replace(/\s+/g, "").toLowerCase()));
  if (found) return found;
  const dataSheet = sheets.find((sheet) => !/说明|instructions|help|readme/i.test(String(sheet.name)));
  return dataSheet || sheets[0];
}

/** 取单元格文本，超过列宽的空位按空串处理。 */
export function cellText(row, index) {
  return row?.[index]?.value ?? "";
}

const CONTENT_TYPES = (sheetCount) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${Array.from({ length: sheetCount }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="等线"/><family val="2"/></font><font><b/><sz val="11"/><name val="等线"/><family val="2"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(rowData, { widths = [], textColumns = [] } = {}) {
  const width = rowData.reduce((max, row) => Math.max(max, row.length), 0);
  const cols = widths.length
    ? `<cols>${widths.map((value, index) => `<col min="${index + 1}" max="${index + 1}" width="${value}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const rows = rowData.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      if (value === "" || value === null || value === undefined) return "";
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      const style = rowIndex === 0 ? 1 : textColumns.includes(columnIndex) ? 2 : 0;
      if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
      const styleAttr = style ? ` s="${style}"` : "";
      return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${columnName(Math.max(width, 1) - 1)}${Math.max(rowData.length, 1)}"/>
<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
${cols}
<sheetData>${rows}</sheetData>
</worksheet>`;
}

/**
 * 生成 .xlsx 字节。sheets: `[{ name, rows, widths?, textColumns? }]`。
 * `textColumns` 会把对应列写成文本格式，避免 Excel 把手机号、凭据转成数字。
 */
export function buildWorkbook({ sheets }) {
  if (!Array.isArray(sheets) || !sheets.length) throw new Error("至少需要一个工作表");
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
</workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("\n")}
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const files = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES(sheets.length)),
    "_rels/.rels": strToU8(ROOT_RELS),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
    "xl/styles.xml": strToU8(STYLES),
  };
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(sheet.rows, sheet));
  });
  return zipSync(files, { level: 6 });
}

export { XLSX_MIME };
