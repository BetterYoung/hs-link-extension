import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("settings page is dedicated to tenant, person, and backup management", async () => {
  const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /租户管理/);
  assert.match(source, /人员管理/);
  assert.match(source, /导入 \/ 导出/);
  assert.match(source, /sidebar-title-row[\s\S]*新增租户/);
  assert.doesNotMatch(source, /generateAccessLink|生成访问链接|访问规则|生成的访问链接|复制链接|打开链接/);
});

test("settings layout uses the selected wider tenant rail", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /grid-template-columns:\s*330px minmax\(0, 1fr\)/);
  assert.match(styles, /\.sidebar-title-row[^{]*\{[^}]*justify-content:\s*space-between/);
});

test("切换部署方式时地址联动：SaaS 用内置地址，本地化清空", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /baseUrl: event\.target\.value === "saas" \? SAAS_DEFAULT_ORIGIN : ""/);
  assert.match(app, /next\.deployment === "saas"[\s\S]{0,80}baseUrl: SAAS_DEFAULT_ORIGIN/);
});

test("标签选择器不嵌表单，避免内层 submit 冒泡保存租户", async () => {
  const picker = await readFile(new URL("../src/TagPicker.jsx", import.meta.url), "utf8");
  // 内联新建标签曾在租户表单里再套一层 form，submit 冒泡到 saveTenant 会直接保存租户。
  assert.doesNotMatch(picker, /onSubmit=\{submit\}/);
  assert.match(picker, /event\.key !== "Enter"/);
  assert.match(picker, /event\.stopPropagation\(\)/);
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /event\.target !== event\.currentTarget/);
});

test("settings page keeps page scrolling contained and paginates personnel", async () => {
  const peopleSource = await readFile(new URL("../src/PeopleView.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(peopleSource, /const PAGE_SIZE = 10/);
  assert.match(peopleSource, /人员列表分页/);
  assert.match(peopleSource, /上一页/);
  assert.match(peopleSource, /下一页/);
  assert.match(styles, /html, body, #root \{[^}]*overflow:\s*hidden/);
  assert.match(styles, /\.tenant-list[^{]*\{[^}]*overflow-y:\s*auto/);
  assert.match(styles, /\.people-table-body[^{]*\{[^}]*overflow-y:\s*auto/);
});

test("settings page supports cURL import, blank enterprise ID and batch person creation", async () => {
  const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /从 cURL 导入/);
  assert.match(source, /留空后自动获取/);
  assert.match(source, /批量新增人员/);
  assert.match(source, /处理中…/);
  assert.match(source, /批量新增结果/);
  assert.match(source, /parseCurlCommand/);
  assert.match(source, /authorizeTenant/);
  assert.match(source, /resolveStaff/);
});

test("settings page supports Excel import for tenants and people", async () => {
  const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const people = await readFile(new URL("../src/PeopleView.jsx", import.meta.url), "utf8");
  assert.match(source, /从 Excel 批量导入/);
  assert.match(source, /从 Excel 导入/);
  assert.match(source, /下载导入模板/);
  assert.match(source, /planTenantImport/);
  assert.match(source, /planPersonImport/);
  assert.match(source, /savePeopleToTenants/);
  assert.match(source, /requestOriginPermissions/);
  assert.match(people, /导入人员/);
  // 导入走增量合并，不得整体替换既有资料。
  assert.doesNotMatch(source, /replaceWorkspace/);
});

test("personnel table lists email and searches by email", async () => {
  const peopleSource = await readFile(new URL("../src/PeopleView.jsx", import.meta.url), "utf8");
  assert.match(peopleSource, /邮箱/);
  assert.match(peopleSource, /搜索姓名、人员 ID、工号、手机号或邮箱/);
  assert.match(peopleSource, /person-email/);
});