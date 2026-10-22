import test from "node:test";
import assert from "node:assert/strict";
import { resolveStaffForTenants, upsertPerson } from "../src/tenantOps.js";

const people = [
  { id: "p1", name: "旧记录", staffId: "S-1", code: "100", phone: "", email: "" },
  { id: "p2", name: "其他", staffId: "S-2", code: "200", phone: "", email: "" },
];

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
  const resolve = async (tenant, person) => {
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