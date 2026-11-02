import test from "node:test";
import assert from "node:assert/strict";
import { PERSON_IMPORT_LIMIT, personTemplateSheets, planPersonImport } from "../src/importPeople.js";

const text = (value) => ({ value: String(value), numeric: false });
const number = (value) => ({ value: String(value), numeric: true });
const sheet = (rows) => rows.map((row) => row.map((value) => value?.value !== undefined ? value : text(value)));
const HEADER = ["姓名", "人员 ID", "工号", "手机号", "邮箱"];

test("planPersonImport 逐行解析五个维度并允许姓名为空", () => {
  const rows = sheet([
    HEADER,
    ["张伟", "EMP:20001", "20001", "13800001111", "zhangwei@example.com"],
    ["", "", "10012", "13900004321", ""],
  ]);
  const plan = planPersonImport(rows);
  assert.equal(plan.items[0].status, "ok");
  assert.equal(plan.items[0].form.staffId, "EMP:20001");
  assert.equal(plan.items[1].status, "ok");
  assert.match(plan.items[1].warning, /姓名为空/);
});

test("planPersonImport 自动跳过第 2 行模板示例，修改过的示例行按数据导入", () => {
  const sheets = personTemplateSheets();
  const rows = sheet([
    sheets[0].rows[0],
    sheets[0].rows[1],
    ["李明", "", "10012", "13900004321", ""],
    ["陈晨", "DEMO:10028", "10028", "13800003268", "chenchen@example.com-new"],
  ]);
  const plan = planPersonImport(rows);
  assert.deepEqual(plan.exampleRows, [2]);
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].rowNumber, 3);
  assert.equal(plan.items[1].rowNumber, 4);
});

test("planPersonImport 拒绝没有任何查询维度的行", () => {
  const rows = sheet([HEADER, ["只有姓名", "", "", "", ""]]);
  const plan = planPersonImport(rows);
  assert.equal(plan.items[0].status, "error");
  assert.match(plan.items[0].error, /至少填写/);
});

test("planPersonImport 对数值列给出丢失前导 0 的提示", () => {
  const rows = sheet([HEADER, ["张三", "", "", number("13800003268"), ""]]);
  const plan = planPersonImport(rows);
  assert.equal(plan.items[0].status, "ok");
  assert.match(plan.items[0].warning, /数字/);
});

test("planPersonImport 跳过完全重复行并提示人员 ID 重复覆盖", () => {
  const rows = sheet([
    HEADER,
    ["张三", "S-1", "", "", ""],
    ["张三", "S-1", "", "", ""],
    ["李四", "S-1", "", "", ""],
  ]);
  const plan = planPersonImport(rows);
  assert.equal(plan.items[0].status, "ok");
  assert.equal(plan.items[1].status, "skip");
  assert.equal(plan.items[2].status, "warn");
  assert.match(plan.items[2].warning, /第 2 行/);
});

test("planPersonImport 拒绝超过上限与缺少维度的表头", () => {
  const tooMany = sheet([HEADER, ...Array.from({ length: PERSON_IMPORT_LIMIT + 1 }, (_, index) => [`人${index}`, `S-${index}`, "", "", ""])]);
  assert.throws(() => planPersonImport(tooMany), /最多导入 100 行/);
  assert.throws(() => planPersonImport(sheet([["姓名", "备注"], ["张三", "x"]]), {}), /人员 ID、工号、手机号与邮箱/);
});

test("人员模板含数据行与说明，并保持可解析", () => {
  const sheets = personTemplateSheets();
  assert.equal(sheets[0].name, "人员");
  assert.deepEqual(sheets[0].rows[0], HEADER);
  assert.equal(sheets[0].rows.length, 2);
  assert.equal(sheets[1].name, "填写说明");
  const plan = planPersonImport(sheet([...sheets[0].rows, ["王五", "EMP:30001", "30001", "13700001111", ""]]));
  assert.deepEqual(plan.exampleRows, [2]);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].rowNumber, 3);
  assert.equal(plan.items[0].status, "ok");
  // 只有示例行时给出明确提示，而不是静默空导入。
  assert.throws(() => planPersonImport(sheet(sheets[0].rows)), /示例数据会自动跳过/);
});
