import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("extension action opens the popup and settings opens the full page", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal(manifest.options_page, "index.html");
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.icons[128], "icons/icon-128.png");
  assert.equal(manifest.action.default_icon[16], "icons/icon-16.png");
});

test("popup has a dedicated entry and does not persist generated links", async () => {
  const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/PopupApp.jsx", import.meta.url), "utf8");
  assert.match(html, /src\/popup-main\.jsx/);
  assert.match(source, /生成链接/);
  assert.match(source, /复制链接/);
  assert.match(source, /打开链接/);
  assert.match(source, /applyResolvedPerson/);
  assert.doesNotMatch(source, /已补齐|人员信息已核验/);
  assert.doesNotMatch(source, /generatedUrl|accessToken/);
});

test("popup offers local name search and an online lookup without batch add", async () => {
  const source = await readFile(new URL("../src/PopupApp.jsx", import.meta.url), "utf8");
  assert.match(source, /tenant-picker/);
  assert.match(source, /person-picker/);
  assert.match(source, /搜索姓名/);
  assert.match(source, /搜索租户名称/);
  assert.match(source, /person-picker-query/);
  assert.match(source, /person-lookup-dims/);
  assert.match(source, /在线查询/);
  assert.match(source, /LOOKUP_DIMENSIONS/);
  assert.match(source, /mergeResolvedPerson/);
  assert.match(source, /storage\??\.onChanged/);
  assert.doesNotMatch(source, /批量新增/);
  assert.doesNotMatch(source, /popup-batch/);
});
