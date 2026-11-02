import test from "node:test";
import assert from "node:assert/strict";
import { groupResultsByPerson, resolveStaffForTenants, savePeopleToTenants, upsertPerson } from "../src/tenantOps.js";

const people = [
  { id: "p1", name: "旧记录", staffId: "S-1", code: "100", phone: "", email: "" },
  { id: "p2", name: "其他", staffId: "S-2", code: "200", phone: "", email: "" },
];

function tenant(id, extra = {}) {
  return {
    id, name: `租户-${id}`, corporationId: `CORP-${id}`, baseUrl: "https://saas.example.com",
    deployment: "saas", appKey: `KEY-${id}`, appSecurity: `SECRET-${id}`,
    people: extra.people ?? [],
  };
}

test("a new person without staff ID is appended", () => {
  const result = upsertPerson(people, { id: "p3", name: "新", staffId: "", code: "300", phone: "", email: "" });
  assert.equal(result.people.length, 3);
  assert.equal(result.person.id, "p3");
});

test("an existing staff ID updates that record and keeps its record ID", () => {
  const result = upsertPerson(people, { id: "p9", name: "更新", staffId: "S-1", code: "101", phone: "", email: "" });
  assert.equal(result.people.length, 2);
  assert.equal(result.person.id, "p1");
  assert.equal(result.person.name, "更新");
  assert.equal(result.people[0].id, "p1");
});

test("an unknown staff ID is appended as a new record", () => {
  const result = upsertPerson(people, { id: "p9", name: "新", staffId: "S-9", code: "900", phone: "", email: "" });
  assert.equal(result.people.length, 3);
  assert.equal(result.person.id, "p9");
});

test("batch resolution keeps matching tenants and reports failures per tenant", async () => {
  const tenants = [
    { id: "t1", name: "华东" },
    { id: "t2", name: "华南" },
    { id: "t3", name: "华北" },
  ];
  const resolve = async (tenant) => {
    if (tenant.id === "t2") throw new Error("未找到员工，请核对人员 ID、工号、手机号或邮箱");
    return { name: `${tenant.name}员工`, staffId: `S-${tenant.id}`, code: "1", phone: "", email: "" };
  };
  const results = await resolveStaffForTenants(tenants, { name: "", staffId: "S-1", code: "", phone: "", email: "" }, resolve);
  assert.equal(results.length, 3);
  assert.equal(results[0].person.name, "华东员工");
  assert.equal(results[0].person.staffId, "S-1");
  assert.match(results[1].error, /未找到员工/);
  assert.equal(results[2].person.name, "华北员工");
});

test("batch resolution skips the lookup when a name is already provided", async () => {
  let calls = 0;
  const resolve = async () => { calls += 1; return { name: "x", staffId: "S", code: "", phone: "", email: "" }; };
  const results = await resolveStaffForTenants([{ id: "t1", name: "华东" }], { name: "已有姓名", staffId: "S-1", code: "", phone: "", email: "" }, resolve);
  assert.equal(calls, 0);
  assert.equal(results[0].person.name, "已有姓名");
});

test("alwaysResolve 在姓名已填写时也查询人员 ID，并回填结果", async () => {
  let calls = 0;
  const resolve = async () => { calls += 1; return { name: "查询姓名", staffId: "S-Q", code: "9", phone: "", email: "" }; };
  const results = await resolveStaffForTenants([{ id: "t1", name: "华东" }], { name: "手填姓名", staffId: "", code: "9", phone: "", email: "" }, resolve, { alwaysResolve: true });
  assert.equal(calls, 1);
  assert.equal(results[0].person.name, "手填姓名");
  assert.equal(results[0].person.staffId, "S-Q");
});

test("alwaysResolve 查不到人员 ID 时该租户失败", async () => {
  const results = await resolveStaffForTenants([{ id: "t1", name: "华东" }], { name: "手填", staffId: "", code: "1", phone: "", email: "" }, async () => ({ name: "x", staffId: "", code: "", phone: "", email: "" }), { alwaysResolve: true });
  assert.match(results[0].error, /未查询到人员 ID/);
});

test("alwaysResolve 校验表格填写的人员 ID 与查询结果一致", async () => {
  const resolve = async () => ({ name: "查询姓名", staffId: "S-REAL", code: "", phone: "", email: "" });
  const results = await resolveStaffForTenants([{ id: "t1", name: "华东" }], { name: "手填", staffId: "S-WRONG", code: "", phone: "", email: "" }, resolve, { alwaysResolve: true });
  assert.match(results[0].error, /不一致/);
});

test("导入模式在姓名已填时仍查询，查不到则写入失败", async () => {
  const tenants = [tenant("t1")];
  const resolve = async () => { throw new Error("未找到员工，请核对人员 ID、工号、手机号或邮箱"); };
  const { results, tenants: saved } = await savePeopleToTenants(tenants, [
    { name: "张三", staffId: "", code: "1", phone: "", email: "" },
  ], { resolve, alwaysResolve: true, makeId: () => "id-1" });
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /未找到员工/);
  assert.equal(saved[0].people.length, 0);
});

test("savePeopleToTenants 把同一个人写入多个租户并共享记录 ID", async () => {
  const tenants = [tenant("t1", { people }), tenant("t2")];
  const resolve = async (target) => ({
    name: "张三",
    staffId: target.id === "t1" ? "S-1" : "S-2",
    code: "1", phone: "", email: "",
  });
  const { tenants: saved, results } = await savePeopleToTenants(tenants, [
    { name: "", staffId: "S-1", code: "", phone: "", email: "" },
  ], { resolve, makeId: () => "id-1" });

  assert.equal(results.length, 2);
  assert.deepEqual(results.map((item) => item.ok), [true, true]);
  assert.equal(saved[0].people.length, 2);
  assert.equal(saved[1].people.length, 1);
  // t1 命中原有 staffId，保留旧记录 ID；t2 使用共享的新记录 ID。
  assert.equal(saved[0].people.find((person) => person.staffId === "S-1").id, "p1");
  assert.equal(saved[1].people[0].id, "id-1");
  assert.equal(saved[1].people[0].name, "张三");
});

test("savePeopleToTenants 单人 × 多租户 与 多行 × 多租户 共用同一条链路", async () => {
  const tenants = [tenant("t1"), tenant("t2")];
  const resolve = async () => ({ name: "匹配姓名", staffId: "S-9", code: "", phone: "", email: "" });
  let counter = 0;
  const { tenants: saved, results } = await savePeopleToTenants(tenants, [
    { name: "张三", staffId: "", code: "1", phone: "", email: "" },
    { name: "", staffId: "S-9", code: "", phone: "", email: "" },
  ], { resolve, makeId: () => `id-${(counter += 1)}` });

  assert.equal(results.length, 4);
  assert.equal(results.filter((item) => item.ok).length, 4);
  assert.equal(new Set(results.map((item) => item.personId)).size, 2);
  assert.equal(saved[0].people.length, 2);
  const resolvedId = saved[0].people.find((person) => person.name === "匹配姓名").id;
  assert.equal(resolvedId, saved[1].people.find((person) => person.name === "匹配姓名").id);
});

test("savePeopleToTenants 单个租户失败不影响其他租户", async () => {
  const tenants = [tenant("t1"), tenant("t2")];
  const resolve = async (target) => {
    if (target.id === "t2") throw new Error("未找到员工，请核对人员 ID、工号、手机号或邮箱");
    return { name: "张三", staffId: "S-1", code: "", phone: "", email: "" };
  };
  const { tenants: saved, results } = await savePeopleToTenants(tenants, [
    { name: "", staffId: "S-1", code: "", phone: "", email: "" },
  ], { resolve, makeId: () => "id-1" });
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.match(results[1].error, /未找到员工/);
  assert.equal(saved[0].people.length, 1);
  assert.equal(saved[1].people.length, 0);
});

test("savePeopleToTenants 在 signal 中止时保留已完成结果", async () => {
  const tenants = [tenant("t1")];
  const resolve = async () => { throw new Error("不应被调用"); };
  const { aborted, results, tenants: saved } = await savePeopleToTenants(tenants, [
    { name: "甲", staffId: "S-A", code: "", phone: "", email: "" },
  ], { resolve, makeId: () => "id-x", signal: { aborted: true } });
  assert.equal(aborted, true);
  assert.equal(results.length, 0);
  assert.equal(saved[0].people.length, 0);
});

test("groupResultsByPerson 按人员行聚合结果", () => {
  const results = [
    { rowIndex: 0, personId: "id-1", personName: "张三", tenantId: "t1", tenantName: "华东", ok: true },
    { rowIndex: 0, personId: "id-1", personName: "张三", tenantId: "t2", tenantName: "华南", ok: false, error: "未找到员工" },
    { rowIndex: 1, personId: "id-2", personName: "李四", tenantId: "t1", tenantName: "华东", ok: true },
  ];
  const groups = groupResultsByPerson(results);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].personName, "张三");
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[1].rowIndex, 1);
});
