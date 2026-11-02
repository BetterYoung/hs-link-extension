import test from "node:test";
import assert from "node:assert/strict";
import { mergeTenantImport, planTenantImport, tenantTemplateSheets } from "../src/importTenants.js";
import { SAAS_ORIGIN } from "../src/config.js";
import { cellText } from "../src/xlsx.js";

const text = (value) => ({ value: String(value), numeric: false });
const number = (value) => ({ value: String(value), numeric: true });
const sheet = (rows) => rows.map((row) => row.map((value) => value?.value !== undefined ? value : text(value)));

const HEADER = ["租户名称", "域名", "appKey", "appSecurity"];

function tenant(id, corporationId, extra = {}) {
  return {
    id, name: `租户-${id}`, corporationId, baseUrl: "https://saas.example.com",
    deployment: "saas", appKey: `KEY-${id}`, appSecurity: `SECRET-${id}`,
    people: [{ id: `p-${id}`, name: "张三", staffId: `S-${id}`, code: "", phone: "", email: "" }],
    ...extra,
  };
}

test("planTenantImport 识别表头并推导部署方式", () => {
  const rows = sheet([
    HEADER,
    ["演示企业", "", "KEY-A", "SECRET-A"],
    ["本地企业", "https://hs.example.com", "KEY-B", "SECRET-B"],
  ]);
  const plan = planTenantImport(rows);
  assert.equal(plan.items.length, 2);
  assert.deepEqual(plan.items.map((item) => item.status), ["create", "create"]);
  assert.equal(plan.items[0].baseUrl, SAAS_ORIGIN);
  assert.equal(plan.items[0].deployment, "saas");
  assert.equal(plan.items[1].deployment, "onPrem");
  assert.equal(plan.items[1].baseUrl, "https://hs.example.com");
});

test("planTenantImport 标记非法域名、缺失字段与被转成数字的凭据", () => {
  const rows = sheet([
    HEADER,
    ["错误域名", "https://hs.example.com/path", "KEY-A", "SECRET-A"],
    ["缺账号", "https://hs.example.com", "", "SECRET-B"],
  ]);
  rows.push([text("数字凭据"), text("https://hs.example.com"), number("123456"), text("SECRET-C")]);
  const plan = planTenantImport(rows);
  assert.equal(plan.items[0].status, "error");
  assert.match(plan.items[0].error, /HTTPS 域名/);
  assert.equal(plan.items[1].status, "error");
  assert.match(plan.items[1].error, /缺少 appKey/);
  assert.equal(plan.items[2].status, "error");
  assert.match(plan.items[2].error, /文本格式/);
});

test("planTenantImport 跳过多余重复行并标记可更新的租户", () => {
  const rows = sheet([
    HEADER,
    ["演示企业", "https://saas.example.com", "KEY-A", "SECRET-A"],
    ["演示企业副本", "https://saas.example.com", "KEY-A", "SECRET-A2"],
  ]);
  const existing = [tenant("t1", "CORP-1", { appKey: "KEY-A" })];
  const plan = planTenantImport(rows, { existing });
  assert.equal(plan.items[0].status, "update");
  assert.equal(plan.items[1].status, "skip");
  assert.match(plan.items[1].error, /第 2 行/);
});

test("planTenantImport 超过 100 行时拒绝导入", () => {
  const rows = sheet([HEADER, ...Array.from({ length: 101 }, (_, index) => [`租户${index}`, "", `KEY-${index}`, `SECRET-${index}`])]);
  assert.throws(() => planTenantImport(rows), /最多导入 100 个租户/);
});

test("planTenantImport 自动跳过第 2 行模板示例，修改过的示例行按数据导入", () => {
  const sheets = tenantTemplateSheets();
  const rows = sheet([
    sheets[0].rows[0],
    sheets[0].rows[1],
    ["真实租户", "https://hs.example.com", "KEY-X", "SECRET-X"],
    ["演示企业", "https://saas.example.com", "DEMO-APP-KEY", "DEMO-ONLY-NOT-A-SECRET-2"],
  ]);
  const plan = planTenantImport(rows);
  assert.deepEqual(plan.exampleRows, [2]);
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].rowNumber, 3);
  assert.equal(plan.items[1].rowNumber, 4);
});

test("planTenantImport 对缺少表头的文件给出模板提示", () => {
  assert.throws(() => planTenantImport(sheet([["随便", "写点"]]), {}), /未识别到表头/);
});

test("mergeTenantImport 按企业 ID 新增与更新，并保留原人员", () => {
  const workspace = { schemaVersion: 1, tenants: [tenant("t1", "CORP-1")], selectedTenantId: "t1", selectedPersonId: "p-t1" };
  const executed = [
    { item: { rowNumber: 2, name: "演示企业", baseUrl: "https://saas.example.com", deployment: "saas", appKey: "KEY-1", appSecurity: "SECRET-1" }, corporationId: "CORP-1" },
    { item: { rowNumber: 3, name: "新企业", baseUrl: "https://hs.example.com", deployment: "onPrem", appKey: "KEY-2", appSecurity: "SECRET-2" }, corporationId: "CORP-2" },
  ];
  let counter = 0;
  const merged = mergeTenantImport(workspace, executed, { makeId: () => `new-${(counter += 1)}` });
  assert.equal(merged.updated.length, 1);
  assert.equal(merged.added.length, 1);
  assert.equal(merged.tenants.length, 2);
  const updated = merged.tenants.find((item) => item.id === "t1");
  assert.equal(updated.name, "演示企业");
  assert.equal(updated.appKey, "KEY-1");
  assert.deepEqual(updated.people, workspace.tenants[0].people);
  assert.equal(merged.tenants.find((item) => item.id === "new-1").people.length, 0);
  assert.equal(merged.selectedTenantId, "t1");
});

test("mergeTenantImport 记录错误的行与本次导入内重复的企业 ID", () => {
  const workspace = { schemaVersion: 1, tenants: [], selectedTenantId: null, selectedPersonId: null };
  const executed = [
    { item: { rowNumber: 2, name: "失败", appKey: "K", appSecurity: "S" }, error: "鉴权失败" },
    { item: { rowNumber: 3, name: "重复一", baseUrl: "https://a.example.com", deployment: "onPrem", appKey: "K1", appSecurity: "S1" }, corporationId: "SAME" },
    { item: { rowNumber: 4, name: "重复二", baseUrl: "https://b.example.com", deployment: "onPrem", appKey: "K2", appSecurity: "S2" }, corporationId: "SAME" },
  ];
  const merged = mergeTenantImport(workspace, executed, { makeId: () => "id-1" });
  assert.equal(merged.added.length, 1);
  assert.equal(merged.failed.length, 2);
  assert.match(merged.failed[1].error, /第 3 行/);
});

test("租户模板包含数据表与填写说明，表头可被规划函数识别", () => {
  const sheets = tenantTemplateSheets();
  assert.equal(sheets[0].name, "租户");
  assert.deepEqual(sheets[0].rows[0], HEADER);
  assert.equal(sheets[0].rows.length, 2);
  assert.equal(sheets[1].name, "填写说明");
  const rows = sheet([...sheets[0].rows, ["真实租户", "", "KEY-R", "SECRET-R"]]);
  assert.equal(cellText(rows[0], 0), "租户名称");
  const plan = planTenantImport(rows);
  assert.deepEqual(plan.exampleRows, [2]);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].rowNumber, 3);
  assert.equal(plan.items[0].status, "create");
  // 只有示例行时给出明确提示，而不是静默空导入。
  assert.throws(() => planTenantImport(sheet(sheets[0].rows)), /示例数据会自动跳过/);
});
