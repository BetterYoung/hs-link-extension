import { normalizePerson } from "./model.js";

/** 弹窗在线查询支持的维度；姓名不在其中（接口不支持按姓名查人）。 */
export const LOOKUP_DIMENSIONS = [
  { key: "staffId", label: "人员 ID", placeholder: "输入人员 ID" },
  { key: "code", label: "工号", placeholder: "输入工号" },
  { key: "phone", label: "手机号", placeholder: "输入手机号" },
  { key: "email", label: "邮箱", placeholder: "输入邮箱" },
];

const LIMITS = { staffId: 150, code: 100, phone: 50, email: 254 };
const defaultMakeId = () => globalThis.crypto?.randomUUID?.() ?? `person-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** 归一化：手机号去掉分隔符，邮箱忽略大小写，其余去首尾空格。 */
export function normalizeLookupValue(dimension, value) {
  const text = String(value ?? "").trim();
  if (dimension === "phone") return text.replace(/[\s\-()]/g, "");
  if (dimension === "email") return text.toLowerCase();
  return text;
}

/** 校验查询值；不通过时抛出的错误可直接展示给用户。 */
export function validateLookupValue(dimension, value) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("请输入查询内容");
  if (text.length > LIMITS[dimension]) throw new Error("查询内容过长");
  if (dimension === "phone" && !/^\d{5,}$/.test(normalizeLookupValue("phone", text))) {
    throw new Error("手机号只能包含数字（可带空格或短横线）");
  }
  if (dimension === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    throw new Error("邮箱格式不正确");
  }
  return normalizeLookupValue(dimension, text);
}

/** 只在当前租户的本地人员里精确匹配；返回命中的记录（可能 0、1 或多条）。 */
export function findLocalMatches(people, { dimension, value }) {
  const target = normalizeLookupValue(dimension, value);
  if (!target) return [];
  return (people || []).filter((person) => {
    if (!["staffId", "code", "phone", "email"].includes(dimension)) return false;
    return normalizeLookupValue(dimension, person[dimension]) === target;
  });
}

/** 构造给 resolveStaff 的查询档案：只填本次维度，避免携带本地旧值。 */
export function lookupQueryPerson(dimension, value) {
  const query = { name: "", staffId: "", code: "", phone: "", email: "" };
  query[dimension] = normalizeLookupValue(dimension, value);
  return query;
}

/**
 * 把接口查到的人员写入本地：
 * - 优先按 staffId 复用记录，其次按工号/手机号/邮箱复用；
 * - 复用记录保留原记录 ID，接口返回的字段直接覆盖（接口没返回的字段保留本地值）；
 * - 没有可复用记录时新建一条。
 */
export function mergeResolvedPerson(people, resolved, { makeId = defaultMakeId } = {}) {
  const current = [...(people || [])];
  const fields = {
    name: String(resolved.name || "").trim(),
    staffId: String(resolved.staffId || "").trim(),
    code: String(resolved.code || "").trim(),
    phone: String(resolved.phone || "").trim(),
    email: String(resolved.email || "").trim(),
  };
  const matchedIndex = current.findIndex((person) => {
    if (fields.staffId && String(person.staffId || "").trim() === fields.staffId) return true;
    return ["code", "phone", "email"].some((key) => {
      const value = normalizeLookupValue(key, fields[key]);
      return value && normalizeLookupValue(key, person[key]) === value;
    });
  });
  if (matchedIndex >= 0) {
    const existing = current[matchedIndex];
    const merged = normalizePerson({
      ...existing,
      name: fields.name || existing.name,
      staffId: fields.staffId || existing.staffId,
      code: fields.code || existing.code,
      phone: fields.phone || existing.phone,
      email: fields.email || existing.email,
    });
    current[matchedIndex] = merged;
    return { people: current, person: merged, created: false };
  }
  const created = normalizePerson({ id: makeId(), ...fields });
  current.push(created);
  return { people: current, person: created, created: true };
}
