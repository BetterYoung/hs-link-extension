import test from "node:test";
import assert from "node:assert/strict";
import { isSaasOrigin, LEGACY_SAAS_ORIGIN, SAAS_ORIGIN } from "../src/config.js";
import { normalizeTenant } from "../src/model.js";

const tenant = (extra = {}) => ({
  id: "t1", name: "租户", corporationId: "CORP-1",
  baseUrl: SAAS_ORIGIN, deployment: "saas",
  appKey: "KEY", appSecurity: "SECRET", people: [],
  ...extra,
});

test("SaaS 入口地址是裸 HTTPS 源，且主机名没有被多拆一段", () => {
  const url = new URL(SAAS_ORIGIN);
  assert.equal(url.protocol, "https:");
  assert.equal(url.pathname, "/");
  assert.equal(url.search, "");
  assert.equal(url.username, "");
  // 之前的默认值被拼成 app.<a>.<b>.com 这种四段式域名，这里锁住三段式结构。
  assert.equal(url.hostname.split(".").length, 3);
  assert.equal(url.hostname.split(".")[0], "app");
  assert.ok(isSaasOrigin(SAAS_ORIGIN));
  assert.ok(!isSaasOrigin(LEGACY_SAAS_ORIGIN));
});

test("读取旧资料时把拼错的 SaaS 默认地址纠正过来", () => {
  const repaired = normalizeTenant(tenant({ baseUrl: LEGACY_SAAS_ORIGIN }));
  assert.equal(repaired.baseUrl, SAAS_ORIGIN);
  // 用户自定义的地址不动
  const custom = normalizeTenant(tenant({ baseUrl: "https://hs.example.com" }));
  assert.equal(custom.baseUrl, "https://hs.example.com");
  // 本地化部署也不动
  const onPrem = normalizeTenant(tenant({ baseUrl: LEGACY_SAAS_ORIGIN, deployment: "onPrem" }));
  assert.equal(onPrem.baseUrl, LEGACY_SAAS_ORIGIN);
});
