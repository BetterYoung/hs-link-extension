import test from "node:test";
import assert from "node:assert/strict";
import {
  createTag,
  DEFAULT_TAG_COLOR,
  normalizeTag,
  normalizeTagList,
  removeTag,
  resolveTagIds,
  TAG_LIMIT,
  tagUsage,
  tagsOf,
  updateTag,
} from "../src/tags.js";
import { createBackup, mergeBackup, normalizeWorkspace, parseBackup } from "../src/model.js";

const tenant = (id, corporationId, extra = {}) => ({
  id, name: `租户-${id}`, corporationId, baseUrl: "https://saas.example.com",
  deployment: "saas", appKey: `KEY-${id}`, appSecurity: `SECRET-${id}`, people: [],
  ...extra,
});

const workspace = (tags = [], tenants = [tenant("t1", "CORP-1")]) => ({
  schemaVersion: 1, tags, tenants, selectedTenantId: "t1", selectedPersonId: null,
});

test("normalizeTag 校验名称并回落到调色板内的颜色", () => {
  assert.deepEqual(normalizeTag({ id: "a", name: "  生产  ", color: "#d92d20" }), { id: "a", name: "生产", color: "#d92d20" });
  assert.equal(normalizeTag({ id: "a", name: "生产", color: "#123456" }).color, DEFAULT_TAG_COLOR);
  assert.equal(normalizeTag({ id: "a", name: "生产" }).color, DEFAULT_TAG_COLOR);
  assert.throws(() => normalizeTag({ id: "a", name: "  " }), /请填写标签名称/);
  assert.throws(() => normalizeTag({ id: "a", name: "标".repeat(21) }), /标签名称过长/);
  assert.throws(() => normalizeTag({ name: "无 id" }), /标签记录 ID/);
});

test("normalizeTagList 去重（id 与名称）并限制总量", () => {
  const list = normalizeTagList([
    { id: "a", name: "生产", color: "#d92d20" },
    { id: "a", name: "重复 id", color: "#d92d20" },
    { id: "b", name: "生产", color: "#175cd3" },
    { id: "c", name: "测试", color: "#b54708" },
  ]);
  assert.deepEqual(list.map((item) => item.id), ["a", "c"]);
  assert.deepEqual(normalizeTagList(undefined), []);
  assert.throws(() => normalizeTagList("x"), /标签库格式不正确/);
  const tooMany = Array.from({ length: TAG_LIMIT + 1 }, (_, index) => ({ id: `t${index}`, name: `标签${index}`, color: "#d92d20" }));
  assert.throws(() => normalizeTagList(tooMany), /标签最多/);
});

test("createTag 拒绝重名与超量，并生成可用的默认颜色", () => {
  const { tags, tag } = createTag([], { name: "生产" }, { makeId: () => "tag-1" });
  assert.deepEqual(tag, { id: "tag-1", name: "生产", color: DEFAULT_TAG_COLOR });
  assert.equal(tags.length, 1);
  assert.throws(() => createTag(tags, { name: "生产" }, { makeId: () => "tag-2" }), /已存在/);
  // 名称比较忽略大小写：英文标签大小写不同也算重名。
  const prod = createTag([], { name: "prod" }, { makeId: () => "tag-p" }).tags;
  assert.throws(() => createTag(prod, { name: "PROD" }, { makeId: () => "tag-q" }), /已存在/);
  const full = Array.from({ length: TAG_LIMIT }, (_, index) => ({ id: `t${index}`, name: `标签${index}`, color: "#d92d20" }));
  assert.throws(() => createTag(full, { name: "新标签" }, { makeId: () => "tag-x" }), /请先删除/);
});

test("updateTag 改名与改色，改名时不允许与其他标签重名", () => {
  const list = normalizeTagList([
    { id: "a", name: "生产", color: "#d92d20" },
    { id: "b", name: "测试", color: "#b54708" },
  ]);
  const renamed = updateTag(list, "b", { name: "测试环境" });
  assert.equal(renamed.find((item) => item.id === "b").name, "测试环境");
  assert.equal(updateTag(list, "b", { color: "#175cd3" }).find((item) => item.id === "b").color, "#175cd3");
  assert.throws(() => updateTag(list, "b", { name: "生产" }), /已存在/);
  assert.throws(() => updateTag(list, "missing", { name: "x" }), /标签不存在/);
});

test("removeTag 删除后不再出现在库中", () => {
  const list = normalizeTagList([{ id: "a", name: "生产", color: "#d92d20" }, { id: "b", name: "测试", color: "#b54708" }]);
  assert.deepEqual(removeTag(list, "a").map((item) => item.id), ["b"]);
});

test("resolveTagIds 按名称解析，未知标签报错，数量不设上限", () => {
  const list = normalizeTagList([
    { id: "a", name: "生产", color: "#d92d20" },
    { id: "b", name: "测试", color: "#b54708" },
    { id: "c", name: "预发", color: "#6941c6" },
  ]);
  assert.deepEqual(resolveTagIds(list, ["生产", " 测试 "]), ["a", "b"]);
  assert.deepEqual(resolveTagIds(list, ["生产", "生产"]), ["a"]);
  assert.deepEqual(resolveTagIds(list, []), []);
  assert.deepEqual(resolveTagIds(list, ["生产", "测试", "预发"]), ["a", "b", "c"], "超过建议数量仍然解析");
  assert.throws(() => resolveTagIds(list, ["中影生产"]), /标签「中影生产」不存在/);
});

test("tagsOf 忽略失效引用，tagUsage 统计占用租户数", () => {
  const tags = normalizeTagList([
    { id: "a", name: "生产", color: "#d92d20" },
    { id: "b", name: "测试", color: "#b54708" },
  ]);
  assert.deepEqual(tagsOf(tags, { tagIds: ["b", "gone"] }).map((item) => item.id), ["b"]);
  assert.deepEqual(tagsOf(tags, {}), []);
  assert.equal(tagUsage([{ tagIds: ["a"] }, { tagIds: ["a", "b"] }, { tagIds: [] }], "a"), 2);
});

test("工作区归一化：旧资料补空标签，失效引用被丢弃，数量不设硬上限", () => {
  const legacy = normalizeWorkspace({ schemaVersion: 1, tenants: [tenant("t1", "CORP-1")], selectedTenantId: "t1", selectedPersonId: null });
  assert.deepEqual(legacy.tags, []);
  assert.deepEqual(legacy.tenants[0].tagIds, []);

  const tags = [{ id: "a", name: "生产", color: "#d92d20" }, { id: "b", name: "测试", color: "#b54708" }, { id: "c", name: "预发", color: "#6941c6" }];
  const normalized = normalizeWorkspace({
    schemaVersion: 1,
    tags,
    tenants: [tenant("t1", "CORP-1", { tagIds: ["a", "gone", "b", "c"] })],
    selectedTenantId: "t1", selectedPersonId: null,
  });
  assert.deepEqual(normalized.tenants[0].tagIds, ["a", "b", "c"]);
});

test("备份导出与导入保留标签库与租户标签", () => {
  const tags = [
    { id: "a", name: "生产", color: "#d92d20" },
    { id: "b", name: "测试", color: "#b54708" },
  ];
  const source = normalizeWorkspace(workspace(tags, [
    tenant("t1", "CORP-1", { tagIds: ["a"] }),
    tenant("t2", "CORP-2", { tagIds: ["a", "b"] }),
  ]));
  const parsed = parseBackup(createBackup(source));
  assert.deepEqual(parsed.tags, tags);
  assert.deepEqual(parsed.tenants.map((item) => item.tagIds), [["a"], ["a", "b"]]);
});

test("增量合并按名称合并标签库、保留本地颜色并重映射租户引用", () => {
  const local = normalizeWorkspace(workspace(
    [{ id: "local-prod", name: "生产", color: "#d92d20" }],
    [tenant("t1", "CORP-1", { tagIds: ["local-prod"] })],
  ));
  const incoming = normalizeWorkspace(workspace(
    [
      { id: "in-prod", name: "生产", color: "#175cd3" },
      { id: "in-test", name: "测试", color: "#b54708" },
    ],
    [tenant("t1", "CORP-1", { tagIds: ["in-prod", "in-test"] })],
  ));
  const merged = mergeBackup(local, incoming);
  assert.deepEqual(merged.tags.map((item) => item.name), ["生产", "测试"]);
  assert.equal(merged.tags[0].color, "#d92d20", "同名标签保留本地颜色");
  assert.deepEqual(merged.tenants[0].tagIds, ["local-prod", merged.tags[1].id]);
});

test("增量合并对租户标签取并集，不设数量上限", () => {
  const local = normalizeWorkspace(workspace(
    [{ id: "a", name: "生产", color: "#d92d20" }, { id: "b", name: "测试", color: "#b54708" }],
    [tenant("t1", "CORP-1", { tagIds: ["a", "b"] })],
  ));
  const incoming = normalizeWorkspace(workspace(
    [{ id: "c", name: "预发", color: "#6941c6" }],
    [tenant("t1", "CORP-1", { tagIds: ["c"] })],
  ));
  const merged = mergeBackup(local, incoming);
  assert.equal(merged.tags.length, 3);
  assert.deepEqual(merged.tenants[0].tagIds, ["a", "b", merged.tags.find((tag) => tag.name === "预发").id]);
});

test("合并按不区分大小写的名称识别同名标签，引用不丢失", () => {
  const local = normalizeWorkspace(workspace(
    [{ id: "local-prod", name: "prod", color: "#d92d20" }],
    [tenant("t1", "CORP-1", { tagIds: [] })],
  ));
  const incoming = normalizeWorkspace(workspace(
    [{ id: "in-prod", name: "PROD", color: "#175cd3" }],
    [tenant("t1", "CORP-1", { tagIds: ["in-prod"] })],
  ));
  const merged = mergeBackup(local, incoming);
  assert.deepEqual(merged.tags.map((item) => item.name), ["prod"], "同名标签只保留一条（本地）");
  assert.equal(merged.tags[0].color, "#d92d20");
  assert.deepEqual(merged.tenants[0].tagIds, ["local-prod"], "导入标签的引用应映射到本地同名标签");
});

test("合并时记录 ID 撞车不会把导入标签错配到本地标签", () => {
  const local = normalizeWorkspace(workspace(
    [{ id: "shared", name: "生产", color: "#d92d20" }],
    [tenant("t1", "CORP-1", { tagIds: ["shared"] })],
  ));
  const incoming = normalizeWorkspace(workspace(
    [{ id: "shared", name: "测试", color: "#b54708" }],
    [tenant("t2", "CORP-2", { tagIds: ["shared"] })],
  ));
  const merged = mergeBackup(local, incoming);
  assert.deepEqual(merged.tags.map((item) => item.name), ["生产", "测试"], "两条不同名称的标签都要保留");
  assert.equal(new Set(merged.tags.map((item) => item.id)).size, 2, "记录 ID 必须唯一");
  const imported = merged.tenants.find((item) => item.corporationId === "CORP-2");
  const resolved = imported.tagIds.map((id) => merged.tags.find((tag) => tag.id === id).name);
  assert.deepEqual(resolved, ["测试"], "导入租户仍指向「测试」，而不是本地「生产」");
});

test("合并标签库时同名判定与库、导入保持一致（忽略首尾空格与大小写）", () => {
  const local = normalizeWorkspace(workspace(
    [{ id: "a", name: " Prod ", color: "#d92d20" }],
    [tenant("t1", "CORP-1", { tagIds: [] })],
  ));
  const incoming = normalizeWorkspace(workspace(
    [{ id: "b", name: "prod", color: "#175cd3" }],
    [tenant("t1", "CORP-1", { tagIds: ["b"] })],
  ));
  const merged = mergeBackup(local, incoming);
  assert.equal(merged.tags.length, 1);
  assert.deepEqual(merged.tenants[0].tagIds, ["a"]);
});
