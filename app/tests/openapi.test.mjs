import test from "node:test";
import assert from "node:assert/strict";
import { authorizeTenant, generateAccessLink, parseCurlCommand, PermissionRequiredError, requestOriginPermission, resolveStaff } from "../src/openapi.js";
import { SAAS_ORIGIN } from "../src/config.js";

const tenant = { corporationId: "CORP-1", baseUrl: "https://entry.example", deployment: "saas", appKey: "key", appSecurity: "secret" };
const person = { staffId: "CORP-1:100", code: "100", phone: "13800000000", email: "test@example.com" };
const response = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });

function mockApi({ staff = false, authCorp = "CORP-1", provisional = { code: "true", message: "https://app.example/access?token=complete" } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (url.pathname.endsWith("/location")) return response({ value: "https://resolved.example" });
    if (url.pathname.endsWith("/getAccessToken")) return response({ value: { accessToken: "temporary-token", corporationId: authCorp } });
    if (url.pathname.endsWith("/getStaffIds")) {
      const record = { id: "CORP-1:100", code: "100", cellphone: "13800000000", name: "Test Person" };
      return response({ items: staff === "phoneOnly" ? (JSON.parse(init.body).type === "CELLPHONE" ? [record] : []) : staff ? [record] : [] });
    }
    if (url.pathname.endsWith("/getProvisionalAuth")) return response({ value: provisional });
    throw new Error("unexpected request");
  };
  return { calls, fetchImpl };
}

test("SaaS resolves host, uses existing staff ID, and returns full URL", async () => {
  const api = mockApi();
  const result = await generateAccessLink(tenant, person, { fetchImpl: api.fetchImpl, checkPermission: async () => true });
  assert.equal(result.url, "https://app.example/access?token=complete");
  assert.equal(api.calls.length, 3);
  assert.equal(new URL(api.calls[0].url).searchParams.get("corpId"), "CORP-1");
  assert.equal(api.calls[1].init.body, JSON.stringify({ appKey: "key", appSecurity: "secret" }));
  assert.deepEqual(JSON.parse(api.calls[2].init.body), { uid: "CORP-1:100", pageType: "frontPage", expireDate: "604800", isApplet: false });
  assert.equal(new URL(api.calls[2].url).searchParams.get("accessToken"), "temporary-token");
});

test("missing ID looks up code first; phone when code is absent", async () => {
  for (const [details, type, condition] of [
    [{ staffId: "", code: "100", phone: "13800000000" }, "CODE", "100"],
    [{ staffId: "", code: "", phone: "13800000000" }, "CELLPHONE", "13800000000"],
  ]) {
    const api = mockApi({ staff: true });
    const result = await generateAccessLink(tenant, details, { fetchImpl: api.fetchImpl, checkPermission: async () => true });
    assert.deepEqual(JSON.parse(api.calls[2].init.body), { type, conditionIds: [condition] });
    assert.deepEqual(result.resolvedPerson, { staffId: "CORP-1:100", code: "100", phone: "13800000000", email: "" });
    assert.equal(api.calls.length, 4);
  }
});

test("existing ID queries by STAFFID when code or phone needs completion", async () => {
  const api = mockApi({ staff: true });
  const result = await generateAccessLink(tenant, { staffId: "CORP-1:100", code: "", phone: "" }, { fetchImpl: api.fetchImpl, checkPermission: async () => true });
  assert.deepEqual(JSON.parse(api.calls[2].init.body), { type: "STAFFID", conditionIds: ["CORP-1:100"] });
  assert.deepEqual(result.resolvedPerson, { staffId: "CORP-1:100", code: "100", phone: "13800000000", email: "" });
  assert.deepEqual(JSON.parse(api.calls[3].init.body), { uid: "CORP-1:100", pageType: "frontPage", expireDate: "604800", isApplet: false });
});

test("falls back to phone only when code lookup finds no employee", async () => {
  const api = mockApi({ staff: "phoneOnly" });
  await generateAccessLink(tenant, { staffId: "", code: "100", phone: "13800000000" }, { fetchImpl: api.fetchImpl, checkPermission: async () => true });
  assert.deepEqual(api.calls.slice(2, 4).map((call) => JSON.parse(call.init.body).type), ["CODE", "CELLPHONE"]);
  assert.equal(api.calls.length, 5);
});

test("new SaaS domain needs permission before credential request", async () => {
  const api = mockApi();
  await assert.rejects(generateAccessLink(tenant, person, { fetchImpl: api.fetchImpl, checkPermission: async () => false }), (error) => error instanceof PermissionRequiredError && error.origin === "https://resolved.example");
  assert.equal(api.calls.length, 1);
});

test("authorization mismatch and API failures stop link generation", async () => {
  const api = mockApi({ authCorp: "OTHER" });
  await assert.rejects(generateAccessLink(tenant, person, { fetchImpl: api.fetchImpl, checkPermission: async () => true }), /企业 ID.*不一致/);
  assert.equal(api.calls.length, 2);
  const bad = mockApi({ provisional: { code: "false", message: "failure" } });
  await assert.rejects(generateAccessLink(tenant, person, { fetchImpl: bad.fetchImpl, checkPermission: async () => true }), /临时授权未成功/);
  const failedFetch = async () => response({}, 500);
  await assert.rejects(generateAccessLink({ ...tenant, deployment: "onPrem" }, person, { fetchImpl: failedFetch }), /HTTP 500/);
});

test("permission request is scoped to HTTPS origin and handles denial", async () => {
  const origins = [];
  const browser = { permissions: { request: async ({ origins: patterns }) => { origins.push(...patterns); return false; } } };
  await assert.rejects(requestOriginPermission("https://entry.example", browser), /未授予/);
  assert.deepEqual(origins, ["https://entry.example/*"]);
});

test("parses a cURL command into address, appKey and appSecurity", () => {
  const parsed = parseCurlCommand("curl 'https://api.example.com/api/openapi/v1/auth/getAccessToken' --data-raw '{\"appKey\":\"AK\",\"appSecurity\":\"AS\"}'");
  assert.deepEqual(parsed, { baseUrl: "https://api.example.com", appKey: "AK", appSecurity: "AS", deployment: "onPrem" });
  assert.equal(parseCurlCommand(`curl '${SAAS_ORIGIN}/x' -d '{\"appKey\":\"AK\",\"appSecurity\":\"AS\"}'`).deployment, "saas");
});

test("rejects unusable cURL commands with actionable messages", () => {
  assert.throws(() => parseCurlCommand(""), /请粘贴 cURL 命令/);
  assert.throws(() => parseCurlCommand("curl 'https://api.example.com/x'"), /请求体/);
  assert.throws(() => parseCurlCommand("curl 'https://api.example.com/x' -d 'nope'"), /不是有效的 JSON/);
  assert.throws(() => parseCurlCommand("curl 'https://api.example.com/x' -d '{\"appSecurity\":\"AS\"}'"), /缺少 appKey/);
  assert.throws(() => parseCurlCommand("curl 'https://api.example.com/x' -d '{\"appKey\":\"AK\"}'"), /缺少 appSecurity/);
  assert.throws(() => parseCurlCommand("curl 'http://api.example.com/x' -d '{\"appKey\":\"AK\",\"appSecurity\":\"AS\"}'"), /访问地址/);
  assert.throws(() => parseCurlCommand("curl --url 'http://api.example.com/x' -d '{\"appKey\":\"AK\",\"appSecurity\":\"AS\"}'"), /HTTPS/);
});

test("tenant authorization fills a blank enterprise ID and refuses a mismatch", async () => {
  const api = mockApi();
  const authorized = await authorizeTenant({ ...tenant, corporationId: "" }, { fetchImpl: api.fetchImpl, requestPermission: async () => {} });
  assert.equal(authorized.corporationId, "CORP-1");
  assert.equal(authorized.accessToken, "temporary-token");
  await assert.rejects(authorizeTenant({ ...tenant, corporationId: "OTHER" }, { fetchImpl: api.fetchImpl, requestPermission: async () => {} }), /企业 ID.*不一致/);
});

test("staff lookup falls back through staff ID, code, phone and email", async () => {
  const api = mockApi({ staff: true });
  const resolved = await resolveStaff(tenant, { email: "test@example.com" }, { fetchImpl: api.fetchImpl, authorize: async () => ({ accessToken: "temporary-token", corporationId: "CORP-1", origin: "https://resolved.example" }) });
  assert.equal(resolved.name, "Test Person");
  assert.equal(resolved.staffId, "CORP-1:100");
  assert.equal(resolved.email, "");
  await assert.rejects(resolveStaff(tenant, {}, { fetchImpl: api.fetchImpl, authorize: async () => ({ accessToken: "t", corporationId: "C", origin: "o" }) }), /至少|之一/);
});