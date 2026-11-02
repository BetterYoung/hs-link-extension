import { cellText } from "./xlsx.js";

export const PERSON_IMPORT_LIMIT = 100;

const ALIASES = {
  name: ["姓名", "名字", "名称", "name"],
  staffId: ["人员id", "员工id", "staffid", "人员编号"],
  code: ["工号", "code", "员工编号"],
  phone: ["手机号", "手机", "电话", "cellphone", "mobile", "phone"],
  email: ["邮箱", "邮件", "邮件地址", "mail", "email"],
};

const COLUMN_LABEL = {
  name: "姓名",
  staffId: "人员 ID",
  code: "工号",
  phone: "手机号",
  email: "邮箱",
};

const LIMITS = { name: 80, staffId: 150, code: 100, phone: 50, email: 254 };
const DIMENSIONS = ["staffId", "code", "phone", "email"];

/** 模板固定示例行：导入时自动跳过，不要求用户先删除。 */
export const PERSON_EXAMPLE = Object.freeze({
  name: "陈晨",
  staffId: "DEMO:10028",
  code: "10028",
  phone: "13800003268",
  email: "chenchen@example.com",
});

function isExampleRow(row, columns) {
  return ["name", ...DIMENSIONS].every((key) => columns[key] >= 0
    && cellText(row, columns[key]).trim() === PERSON_EXAMPLE[key]);
}

function normalizeHeader(value) {
  return String(value ?? "").replace(/\s+/g, "").replace(/[（）()]/g, "").toLowerCase();
}

function findColumn(headerRow, aliases) {
  const keys = aliases.map(normalizeHeader);
  for (let index = 0; index < (headerRow?.length || 0); index += 1) {
    if (keys.includes(normalizeHeader(cellText(headerRow, index)))) return index;
  }
  return -1;
}

function isEmptyRow(row) {
  return !row?.some((item) => String(item?.value ?? "").trim());
}

function locateColumns(rows) {
  let best = null;
  for (let index = 0; index < Math.min(rows.length, 6); index += 1) {
    const columns = {};
    for (const key of Object.keys(ALIASES)) columns[key] = findColumn(rows[index], ALIASES[key]);
    const matched = Object.values(columns).filter((position) => position >= 0).length;
    if (matched >= 1 && (!best || matched > best.matched)) best = { headerIndex: index, columns, matched };
  }
  if (!best) throw new Error("未识别到表头，请使用「下载导入模板」提供的表格格式");
  if (!DIMENSIONS.some((key) => best.columns[key] >= 0)) {
    throw new Error("表头缺少人员 ID、工号、手机号与邮箱列，无法匹配员工");
  }
  return best;
}

/** 读取并校验人员表格：不联网，只产出逐行计划。 */
export function planPersonImport(rows, { maxRows = PERSON_IMPORT_LIMIT } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("文件没有可读取的内容");
  const { headerIndex, columns } = locateColumns(rows);
  const dataRows = rows.slice(headerIndex + 1).filter((row) => !isEmptyRow(row));
  const exampleRows = [];
  const pending = [];
  dataRows.forEach((row, offset) => {
    const rowNumber = headerIndex + offset + 2;
    if (isExampleRow(row, columns)) {
      exampleRows.push(rowNumber);
      return;
    }
    pending.push({ row, rowNumber });
  });
  if (pending.length > maxRows) throw new Error(`一次最多导入 ${maxRows} 行人员，当前 ${pending.length} 行，请拆分后再导入`);
  if (!pending.length) throw new Error("表格里没有可导入的数据行（第 2 行示例数据会自动跳过）");

  const items = [];
  const seenStaffIds = new Map();
  const seenTuples = new Map();

  for (const { row, rowNumber } of pending) {
    const form = {};
    for (const key of Object.keys(ALIASES)) form[key] = columns[key] >= 0 ? cellText(row, columns[key]).trim() : "";
    const item = { rowNumber, form, status: "ok" };

    if (!DIMENSIONS.some((key) => form[key])) {
      item.status = "error";
      item.error = "至少填写人员 ID、工号、手机号或邮箱之一";
      items.push(item);
      continue;
    }
    const tooLong = Object.keys(ALIASES).find((key) => form[key].length > LIMITS[key]);
    if (tooLong) {
      item.status = "error";
      item.error = `${COLUMN_LABEL[tooLong]}过长（最多 ${LIMITS[tooLong]} 字）`;
      items.push(item);
      continue;
    }
    if (!form.name) {
      item.warning = "姓名为空，导入时会按各租户查询并回填姓名";
    }
    const numericKey = ["staffId", "code", "phone"].find((key) => columns[key] >= 0 && row?.[columns[key]]?.numeric);
    if (numericKey) {
      item.warning = `${COLUMN_LABEL[numericKey]}列被 Excel 存成数字，可能丢失前导 0，建议设为文本格式`;
    }

    const tuple = ["name", ...DIMENSIONS].map((key) => form[key]).join("|");
    if (seenTuples.has(tuple)) {
      item.status = "skip";
      item.duplicateOf = seenTuples.get(tuple);
      item.error = `与第 ${seenTuples.get(tuple)} 行内容完全相同，已跳过`;
      items.push(item);
      continue;
    }
    seenTuples.set(tuple, rowNumber);

    if (form.staffId) {
      if (seenStaffIds.has(form.staffId)) {
        item.status = "warn";
        item.duplicateOf = seenStaffIds.get(form.staffId);
        item.warning = `人员 ID 与第 ${seenStaffIds.get(form.staffId)} 行相同，导入时后者覆盖前者`;
      } else {
        seenStaffIds.set(form.staffId, rowNumber);
      }
    }
    items.push(item);
  }

  return { items, headerIndex, exampleRows };
}

/** 人员导入模板：数据表 + 填写说明。第 2 行固定为示例数据，导入时自动跳过。 */
export function personTemplateSheets() {
  return [
    {
      name: "人员",
      rows: [
        ["姓名", "人员 ID", "工号", "手机号", "邮箱"],
        [PERSON_EXAMPLE.name, PERSON_EXAMPLE.staffId, PERSON_EXAMPLE.code, PERSON_EXAMPLE.phone, PERSON_EXAMPLE.email],
      ],
      widths: [14, 18, 14, 18, 28],
      textColumns: [1, 2, 3],
    },
    {
      name: "填写说明",
      rows: [
        ["1. 第 2 行是示例数据，导入时会自动跳过，直接在下方填写真实人员即可。"],
        ["2. 姓名可留空；无论是否填写姓名，导入都会用各租户的凭证查询人员 ID，查不到的行会失败。"],
        ["3. 人员 ID、工号、手机号、邮箱至少填写一列；同一租户内按人员 ID 去重。"],
        ["4. 人员 ID、工号、手机号列已设为文本格式，请勿改成数值，避免丢失前导 0。"],
        ["5. 导入的租户范围在弹窗内选择；一次最多导入 100 行。"],
      ],
    },
  ];
}
