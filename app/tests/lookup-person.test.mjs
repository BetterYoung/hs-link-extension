import test from "node:test";
import assert from "node:assert/strict";
import {
  findLocalMatches,
  LOOKUP_DIMENSIONS,
  lookupQueryPerson,
  mergeResolvedPerson,
  normalizeLookupValue,
  validateLookupValue,
} from "../src/lookupPerson.js";

const people = [
  { id: "p1", name: "张三", staffId: "S-1", code: "10012", phone: "13800003268", email: "zhangsan@example.com" },
  { id: "p2", name: "李四", staffId: "", code: "10013", phone: "139-0000-4321", email: "LiSi@Example.com" },
];

test("LOOKUP_DIMENSIONS 覆盖人员 ID、工号、手机号与邮箱", () => {
  assert.deepEqual(LOOKUP_DIMENSIONS.map((item) => item.key), ["staffId", "code", "phone", "email"]);
});

test("normalizeLookupValue 归一化手机号与邮箱", () => {
  assert.equal(normalizeLookupValue("phone", " 138-0000-3268 "), "13800003268");
  assert.equal(normalizeLookupValue("email", " LiSi@Example.com "), "lisi@example.com");
  assert.equal(normalizeLookupValue("code", " 10012 "), "10012");
});

test("validateLookupValue 拒绝空值、非法手机号与邮箱", () => {
  assert.throws(() => validateLookupValue("staffId", "  "), /请输入查询内容/);
  assert.throws(() => validateLookupValue("phone", "138abcd"), /只能包含数字/);
  assert.throws(() => validateLookupValue("email", "not-an-email"), /邮箱格式不正确/);
  assert.equal(validateLookupValue("email", " A@B.COM "), "a@b.com");
});

test("findLocalMatches 按维度精确匹配且忽略手机号/邮箱格式差异", () => {
  assert.equal(findLocalMatches(people, { dimension: "staffId", value: "S-1" })[0].id, "p1");
  assert.equal(findLocalMatches(people, { dimension: "code", value: "10013" })[0].id, "p2");
  assert.equal(findLocalMatches(people, { dimension: "phone", value: "139 0000 4321" })[0].id, "p2");
  assert.equal(findLocalMatches(people, { dimension: "email", value: "LISI@example.com" })[0].id, "p2");
  assert.deepEqual(findLocalMatches(people, { dimension: "phone", value: "13800009999" }), []);
});

test("lookupQueryPerson 只携带本次查询维度", () => {
  assert.deepEqual(lookupQueryPerson("phone", "138 0000 3268"), { name: "", staffId: "", code: "", phone: "13800003268", email: "" });
});

test("mergeResolvedPerson 按 staffId 覆盖本地记录并保留记录 ID", () => {
  const result = mergeResolvedPerson(people, {
    name: "张三（更新）", staffId: "S-1", code: "20012", phone: "13800009999", email: "new@example.com",
  }, { makeId: () => "new-id" });
  assert.equal(result.created, false);
  assert.equal(result.person.id, "p1");
  assert.equal(result.person.name, "张三（更新）");
  assert.equal(result.person.code, "20012");
  assert.equal(result.people.length, 2);
});

test("mergeResolvedPerson 可按手机号复用没有人员 ID 的本地记录", () => {
  const result = mergeResolvedPerson(people, {
    name: "李四", staffId: "S-2", code: "", phone: "13900004321", email: "",
  }, { makeId: () => "new-id" });
  assert.equal(result.created, false);
  assert.equal(result.person.id, "p2");
  assert.equal(result.person.staffId, "S-2");
  // 接口未返回的字段保留本地值。
  assert.equal(result.person.code, "10013");
  assert.equal(result.person.email, "LiSi@Example.com");
});

test("mergeResolvedPerson 没有可复用记录时新建", () => {
  const result = mergeResolvedPerson(people, {
    name: "王五", staffId: "S-3", code: "30012", phone: "", email: "",
  }, { makeId: () => "new-id" });
  assert.equal(result.created, true);
  assert.equal(result.person.id, "new-id");
  assert.equal(result.people.length, 3);
});
