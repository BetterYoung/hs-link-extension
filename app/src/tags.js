/**
 * 租户标签：调色板、上限与标签库增删改。
 * 保持无 React、无 DOM，便于 `node --test` 直接引用；也不依赖 model.js，避免循环引用。
 */

/** 调色板：浅底上对比度足够；chip 始终带文字，不靠颜色单独传达信息。 */
export const TAG_PALETTE = Object.freeze([
  "#d92d20", // 红
  "#b54708", // 橙
  "#6941c6", // 紫
  "#175cd3", // 蓝
  "#0e9384", // 青
  "#475467", // 灰
  "#c11574", // 玫红
  "#3b7c0f", // 绿
]);

export const DEFAULT_TAG_COLOR = TAG_PALETTE[5];
export const TAG_LIMIT = 50;
/** 建议值，仅用于界面提示；不再强制限制单个租户的标签数量。 */
export const TENANT_TAG_RECOMMENDED = 2;
export const TAG_NAME_LIMIT = 20;

/** 空库时提供的一键预设，由用户点击后才写入，不会自动创建。 */
export const TAG_PRESETS = Object.freeze([
  { name: "生产", color: "#d92d20" },
  { name: "测试", color: "#b54708" },
  { name: "预发", color: "#6941c6" },
  { name: "开发", color: "#175cd3" },
]);

function trimmed(value) {
  return String(value ?? "").trim();
}

/**
 * 标签名称的唯一性口径：忽略首尾空格与大小写。
 * 库内去重、创建、改名、Excel 导入与备份合并必须用同一个口径，
 * 否则会出现"库里只有一个标签、租户引用却被丢弃"的错配。
 */
export function tagNameKey(value) {
  // 用 toLowerCase 而不是 toLocaleLowerCase：标签身份不能随系统语言变化（如土耳其语的 I/i）。
  return trimmed(value).toLowerCase();
}

export function sameTagName(left, right) {
  return tagNameKey(left) === tagNameKey(right);
}

/** 校验并规整单个标签；颜色不在调色板内时回落默认灰。 */
export function normalizeTag(input) {
  if (!input || typeof input !== "object") throw new Error("标签格式不正确");
  const id = trimmed(input.id);
  if (!id) throw new Error("标签记录 ID 不能为空");
  if (id.length > 100) throw new Error("标签记录 ID 过长");
  const name = trimmed(input.name);
  if (!name) throw new Error("请填写标签名称");
  if (name.length > TAG_NAME_LIMIT) throw new Error(`标签名称过长（最多 ${TAG_NAME_LIMIT} 字）`);
  const color = TAG_PALETTE.includes(trimmed(input.color)) ? trimmed(input.color) : DEFAULT_TAG_COLOR;
  return { id, name, color };
}

/** 批量规整标签库：去重（按 id 与名称，保留先出现的），超过上限直接报错。 */
export function normalizeTagList(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error("标签库格式不正确");
  if (input.length > TAG_LIMIT) throw new Error(`标签最多 ${TAG_LIMIT} 个`);
  const list = [];
  for (const entry of input) {
    const tag = normalizeTag(entry);
    if (list.some((item) => item.id === tag.id)) continue;
    if (list.some((item) => sameTagName(item.name, tag.name))) continue;
    list.push(tag);
  }
  return list;
}

/** 新建标签：名称不可重复，库容量受限；返回新库与新建项。 */
export function createTag(list, { name, color }, { makeId = () => crypto.randomUUID() } = {}) {
  const tags = normalizeTagList(list);
  if (tags.length >= TAG_LIMIT) throw new Error(`标签最多 ${TAG_LIMIT} 个，请先删除不再使用的标签`);
  const candidate = normalizeTag({ id: makeId(), name, color: color ?? DEFAULT_TAG_COLOR });
  if (tags.some((item) => sameTagName(item.name, candidate.name))) {
    throw new Error(`标签「${candidate.name}」已存在`);
  }
  return { tags: [...tags, candidate], tag: candidate };
}

/** 改名/改色：改名时不允许与其他标签重名。 */
export function updateTag(list, id, patch) {
  const tags = normalizeTagList(list);
  const index = tags.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("标签不存在，可能已被删除");
  const current = tags[index];
  const next = normalizeTag({ ...current, ...patch, id: current.id });
  if (tags.some((item) => item.id !== id && sameTagName(item.name, next.name))) {
    throw new Error(`标签「${next.name}」已存在`);
  }
  return tags.map((item) => (item.id === id ? next : item));
}

/** 删除标签：调用方负责同时从租户上摘除引用。 */
export function removeTag(list, id) {
  return normalizeTagList(list).filter((item) => item.id !== id);
}

/** 标签名 → 标签 id；未知名称直接报错，供 Excel 导入的逐行校验使用。 */
export function resolveTagIds(list, names) {
  const tags = normalizeTagList(list);
  const ids = [];
  for (const raw of names || []) {
    const name = trimmed(raw);
    if (!name) continue;
    const found = tags.find((item) => sameTagName(item.name, name));
    if (!found) throw new Error(`标签「${name}」不存在，请先在标签管理中创建`);
    if (!ids.includes(found.id)) ids.push(found.id);
  }
  return ids;
}

/** 取租户上的标签对象，忽略已失效的引用（工作区数据已归一化，这里不再重复校验）。 */
export function tagsOf(list, tenant) {
  const tags = Array.isArray(list) ? list : [];
  const ids = Array.isArray(tenant?.tagIds) ? tenant.tagIds : [];
  return ids.map((id) => tags.find((item) => item.id === id)).filter(Boolean);
}

/** 标签库容量与占用统计，供管理弹窗展示影响面。 */
export function tagUsage(tenants, tagId) {
  return (tenants || []).filter((tenant) => (tenant.tagIds || []).includes(tagId)).length;
}
