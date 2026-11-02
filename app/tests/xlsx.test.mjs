import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { buildWorkbook, cellText, pickSheet, readSheets, XLSX_MIME } from "../src/xlsx.js";

test("buildWorkbook 生成的表格可以被 readSheets 还原", () => {
  const bytes = buildWorkbook({
    sheets: [
      {
        name: "租户",
        rows: [
          ["租户名称", "域名", "appKey", "appSecurity"],
          ["演示企业", "https://saas.example.com", "DEMO-APP-KEY", "DEMO-ONLY-NOT-A-SECRET"],
        ],
        widths: [18, 28, 24, 28],
        textColumns: [2, 3],
      },
      { name: "填写说明", rows: [["请勿填写真实凭据"]] },
    ],
  });
  const sheets = readSheets(bytes);
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].name, "租户");
  assert.equal(cellText(sheets[0].rows[0], 0), "租户名称");
  assert.equal(cellText(sheets[0].rows[1], 3), "DEMO-ONLY-NOT-A-SECRET");
  assert.equal(sheets[0].rows[1][3].numeric, false);
  assert.equal(sheets[1].name, "填写说明");
});

test("读取时把数值单元格标记为 numeric", () => {
  const bytes = buildWorkbook({
    sheets: [{ name: "人员", rows: [["姓名", "手机号"], ["张三", 13800003268]] }],
  });
  const sheets = readSheets(bytes);
  assert.equal(cellText(sheets[0].rows[1], 0), "张三");
  assert.equal(cellText(sheets[0].rows[1], 1), "13800003268");
  assert.equal(sheets[0].rows[1][1].numeric, true);
});

test("readSheets 支持共享字符串与内联字符串混合的工作簿", () => {
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>张三</t></is></c><c r="B2" t="s"><v>2</v></c></row>
</sheetData></worksheet>`;
  const shared = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
<si><t>姓名</t></si><si><t>工号</t></si><si><t>10028</t></si></sst>`;
  const bytes = zipSync({
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="人员" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
    "xl/sharedStrings.xml": strToU8(shared),
  });
  const sheets = readSheets(bytes);
  assert.equal(cellText(sheets[0].rows[0], 1), "工号");
  assert.equal(cellText(sheets[0].rows[1], 0), "张三");
  assert.equal(cellText(sheets[0].rows[1], 1), "10028");
});

test("readSheets 对损坏文件与缺失工作簿给出明确错误", () => {
  assert.throws(() => readSheets(strToU8("not a zip")), /无法读取该文件/);
  assert.throws(() => readSheets(zipSync({ "readme.txt": strToU8("hi") })), /不是有效的 Excel 工作簿/);
});

test("pickSheet 优先匹配指定名称并跳过说明页", () => {
  const sheets = [
    { name: "填写说明", rows: [] },
    { name: " 租户 ", rows: [] },
  ];
  assert.equal(pickSheet(sheets, ["租户"]).name, " 租户 ");
  assert.equal(pickSheet([{ name: "填写说明", rows: [] }, { name: "Sheet1", rows: [] }], []).name, "Sheet1");
});

test("模板格式常量与扩展名匹配", () => {
  assert.match(XLSX_MIME, /spreadsheetml\.sheet$/);
});
