import test from "node:test";
import assert from "node:assert/strict";
import { applyResolvedPerson, applyResolvedStaffId, BACKUP_FORMAT, createBackup, mergeBackup, normalizeOrigin, normalizePerson, normalizeTenant, normalizeWorkspace, parseBackup } from "../src/model.js";

const workspace = {
  schemaVersion: 1,
  tenants: [{
    id: "t1", name: "Example", corporationId: "CORP-1", baseUrl: "https://example.com",
    deployment: "saas", appKey: "test-key", appSecurity: "test-secret",
    people: [{ id: "p1", name: "Test Person", staffId: "CORP-1:100", code: "100", phone: "13800000000", email: "test@example.com" }],
  }],
  selectedTenantId: "t1", selectedPersonId: "p1",
};

test("增量合并按企业 ID 和人员 ID 匹配，保留本地值并补充资料", () => {
  const local = structuredClone(workspace);
  local.tenants[0].people[0].email = "";
  const backup = structuredClone(workspace);
  backup.tenants[0].id = "other-tenant-id";
  backup.tenants[0].appSecurity = "other-secret";
  backup.tenants[0].people[0].id = "other-person-id";
  backup.tenants[0].people.push({ id: "p2", name: "New", staffId: "S2", code: "", phone: "", email: "" });
  backup.tenants.push({ ...structuredClone(workspace.tenants[0]), id: "t2", corporationId: "CORP-2", people: [] });
  const merged = mergeBackup(local, backup);
  assert.equal(merged.tenants.length, 2);
  assert.equal(merged.tenants[0].id, "t1");
  assert.equal(merged.tenants[0].appSecurity, "test-secret");
  assert.equal(merged.tenants[0].people[0].id, "p1");
  assert.equal(merged.tenants[0].people[0].email, "test@example.com");
  assert.equal(merged.tenants[0].people[1].id, "p2");
  assert.equal(merged.selectedPersonId, "p1");
  assert.equal(local.tenants[0].people[0].email, "");
});

test("增量合并拒绝身份冲突和重复企业 ID", () => {
  const conflictingTenant = structuredClone(workspace);
  conflictingTenant.tenants[0].corporationId = "OTHER";
  assert.throws(() => mergeBackup(workspace, conflictingTenant), /租户记录 ID/);
  const conflictingPerson = structuredClone(workspace);
  conflictingPerson.tenants[0].people[0].staffId = "OTHER";
  assert.throws(() => mergeBackup(workspace, conflictingPerson), /人员 ID 冲突/);
  const duplicate = structuredClone(workspace);
  duplicate.tenants.push({ ...duplicate.tenants[0], id: "t2" });
  assert.throws(() => mergeBackup(workspace, duplicate), /重复企业 ID/);
});

test("backup preserves tenant/person data and plaintext credentials, but no access links", () => {
  const backup = createBackup({ ...workspace, accessToken: "not-saved", generatedUrl: "not-saved" });
  assert.equal(JSON.parse(backup).format, BACKUP_FORMAT);
  assert.equal(JSON.parse(backup).tenants[0].appSecurity, "test-secret");
  assert.equal(JSON.parse(backup).tenants[0].people[0].email, "test@example.com");
  assert.equal(backup.includes("not-saved"), false);
  assert.deepEqual(parseBackup(backup), normalizeWorkspace(workspace));
});

test("rejects malformed, foreign, and invalid backup without changing data", () => {
  assert.throws(() => parseBackup("{"), /有效的 JSON/);
  assert.throws(() => parseBackup(JSON.stringify(workspace)), /不是本工具/);
  assert.throws(() => parseBackup(JSON.stringify({ ...workspace, format: BACKUP_FORMAT, tenants: [{ ...workspace.tenants[0], baseUrl: "http://example.com" }] })), /HTTPS/);
  assert.throws(() => parseBackup(JSON.stringify({ ...workspace, format: BACKUP_FORMAT, tenants: [workspace.tenants[0], workspace.tenants[0]] })), /重复/);
});

test("accepts only bare HTTPS origins", () => {
  assert.equal(normalizeOrigin("https://example.com/"), "https://example.com");
  for (const url of ["http://example.com", "https://example.com/api", "https://user:pass@example.com", "https://example.com/?x=1"]) {
    assert.throws(() => normalizeOrigin(url), /HTTPS/);
  }
});

test("stores a resolved staff ID in the matching tenant person profile", () => {
  const withoutId = { ...workspace, tenants: [{ ...workspace.tenants[0], people: [{ ...workspace.tenants[0].people[0], staffId: "" }] }] };
  const updated = applyResolvedStaffId(withoutId, "t1", "p1", "CORP-1:resolved");
  assert.equal(updated.tenants[0].people[0].staffId, "CORP-1:resolved");
  assert.equal(withoutId.tenants[0].people[0].staffId, "");
  assert.throws(() => applyResolvedStaffId(workspace, "t1", "missing", "id"), /档案不存在/);
});

test("fills missing staff ID, code, phone and email without overwriting maintained values", () => {
  const partial = {
    ...workspace,
    tenants: [{ ...workspace.tenants[0], people: [{ ...workspace.tenants[0].people[0], staffId: "", code: "100", phone: "", email: "" }] }],
  };
  const updated = applyResolvedPerson(partial, "t1", "p1", { staffId: "CORP-1:resolved", code: "API-CODE", phone: "13900000000", email: "api@example.com" });
  assert.deepEqual(updated.tenants[0].people[0], {
    ...partial.tenants[0].people[0],
    staffId: "CORP-1:resolved",
    code: "100",
    phone: "13900000000",
    email: "api@example.com",
  });
});

test("person profile accepts email as the only lookup dimension", () => {
  const person = normalizePerson({ id: "p2", name: "Only Mail", staffId: "", code: "", phone: "", email: "only@example.com" });
  assert.equal(person.email, "only@example.com");
  assert.throws(() => normalizePerson({ id: "p3", name: "Nothing", staffId: "", code: "", phone: "", email: "" }), /员工 ID、工号、手机号或邮箱至少填写一个/);
});

test("tenant profile keeps the last record for a duplicated staff ID", () => {
  const tenant = normalizeTenant({
    id: "t1", name: "Example", corporationId: "CORP-1", baseUrl: "https://example.com",
    deployment: "saas", appKey: "key", appSecurity: "secret",
    people: [
      { id: "p1", name: "旧记录", staffId: "CORP-1:100", code: "100", phone: "", email: "" },
      { id: "p2", name: "新记录", staffId: "CORP-1:100", code: "200", phone: "", email: "" },
      { id: "p3", name: "无人员 ID", staffId: "", code: "300", phone: "", email: "" },
    ],
  });
  assert.deepEqual(tenant.people.map((person) => person.id), ["p2", "p3"]);
  assert.equal(tenant.people[0].name, "新记录");
});

test("backups carrying a legacy format identifier are still importable", () => {
  const legacy = JSON.stringify({
    format: "vendor-access-link-backup", schemaVersion: 1,
    tenants: [{ id: "t1", name: "Example", corporationId: "CORP-1", baseUrl: "https://example.com", deployment: "saas", appKey: "key", appSecurity: "secret", people: [{ id: "p1", name: "Test Person", staffId: "CORP-1:100", code: "100", phone: "13800000000" }] }],
    selectedTenantId: "t1", selectedPersonId: "p1",
  });
  assert.equal(parseBackup(legacy).tenants[0].people[0].name, "Test Person");
  assert.throws(() => parseBackup(JSON.stringify({ ...workspace, format: "someone-else" })), /不是本工具/);
});

test("backups without the email field are still importable", () => {
  const legacy = JSON.stringify({
    format: BACKUP_FORMAT, exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    tenants: [{ id: "t1", name: "Example", corporationId: "CORP-1", baseUrl: "https://example.com", deployment: "saas", appKey: "key", appSecurity: "secret", people: [{ id: "p1", name: "Test Person", staffId: "CORP-1:100", code: "100", phone: "13800000000" }] }],
    selectedTenantId: "t1", selectedPersonId: "p1",
  });
  const parsed = parseBackup(legacy);
  assert.equal(parsed.tenants[0].people[0].email, "");
  assert.equal(parsed.tenants[0].people[0].name, "Test Person");
});
