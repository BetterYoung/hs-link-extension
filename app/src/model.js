export const STORAGE_KEY = "access-link-workspace-v1";
import { BACKUP_FORMAT_ID, isKnownBackupFormat, LEGACY_SAAS_ORIGIN, SAAS_ORIGIN } from "./config.js";
import { normalizeTagList, sameTagName } from "./tags.js";

export const BACKUP_FORMAT = BACKUP_FORMAT_ID;
export const SCHEMA_VERSION = 1;

export function emptyWorkspace() {
  return { schemaVersion: SCHEMA_VERSION, tags: [], tenants: [], selectedTenantId: null, selectedPersonId: null };
}

export function normalizeOrigin(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new Error("访问地址必须是完整的 HTTPS 地址");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("访问地址只能填写 HTTPS 域名，不含路径、账号或参数");
  }
  return url.origin;
}

function text(value, label, max = 200, required = false) {
  if (typeof value !== "string") throw new Error(`${label}格式不正确`);
  const result = value.trim();
  if (required && !result) throw new Error(`请填写${label}`);
  if (result.length > max) throw new Error(`${label}过长`);
  return result;
}

export function normalizePerson(input) {
  const person = {
    id: text(input.id, "人员记录 ID", 100, true),
    name: text(input.name, "姓名", 80, true),
    staffId: text(input.staffId ?? "", "员工 ID", 150),
    code: text(input.code ?? "", "工号", 100),
    phone: text(input.phone ?? "", "手机号", 50),
    email: text(input.email ?? "", "邮箱", 254),
  };
  if (!person.staffId && !person.code && !person.phone && !person.email) {
    throw new Error("员工 ID、工号、手机号或邮箱至少填写一个");
  }
  return person;
}

/** 租户标签引用：去重；悬空引用与超量截断由 normalizeWorkspace 统一处理。 */
function normalizeTagIds(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error("租户标签格式不正确");
  const ids = [];
  for (const value of input) {
    const id = text(value, "标签记录 ID", 100, true);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function normalizeTenant(input) {
  if (!Array.isArray(input.people) || input.people.length > 1000) throw new Error("人员列表格式不正确");
  const tenant = {
    id: text(input.id, "租户记录 ID", 100, true),
    name: text(input.name, "租户名称", 100, true),
    corporationId: text(input.corporationId, "租户 ID", 150, true),
    baseUrl: normalizeOrigin(input.baseUrl),
    deployment: input.deployment,
    appKey: text(input.appKey, "接入账号", 300, true),
    appSecurity: text(input.appSecurity, "接入密码", 500, true),
    tagIds: normalizeTagIds(input.tagIds),
    people: input.people.map(normalizePerson),
  };
  // 同一租户内按人员 ID（staffId）去重，保留最后一条
  const uniqueStaffIds = new Set();
  tenant.people = [...tenant.people].reverse().filter((person) => {
    if (!person.staffId) return true;
    if (uniqueStaffIds.has(person.staffId)) return false;
    uniqueStaffIds.add(person.staffId);
    return true;
  }).reverse();
  if (!["saas", "onPrem"].includes(tenant.deployment)) throw new Error("部署方式不正确");
  // 历史版本把 SaaS 默认地址拼错，读到就纠正；用户自定义的地址保持原样。
  if (tenant.deployment === "saas" && tenant.baseUrl === LEGACY_SAAS_ORIGIN) tenant.baseUrl = SAAS_ORIGIN;
  if (new Set(tenant.people.map((person) => person.id)).size !== tenant.people.length) {
    throw new Error("人员记录 ID 重复");
  }
  return tenant;
}

export function normalizeWorkspace(input) {
  if (!input || typeof input !== "object" || input.schemaVersion !== SCHEMA_VERSION ||
      !Array.isArray(input.tenants) || input.tenants.length > 200) {
    throw new Error("备份版本或资料格式不受支持");
  }
  const tags = normalizeTagList(input.tags);
  const knownTagIds = new Set(tags.map((tag) => tag.id));
  // 手工编辑或跨库合并后可能残留失效引用，这里统一丢弃，避免整份资料读不出来。
  const tenants = input.tenants.map((tenant) => {
    const normalized = normalizeTenant(tenant);
    return {
      ...normalized,
      tagIds: normalized.tagIds.filter((id) => knownTagIds.has(id)),
    };
  });
  if (new Set(tenants.map((tenant) => tenant.id)).size !== tenants.length) {
    throw new Error("租户记录 ID 重复");
  }
  const selectedTenantId = tenants.some((tenant) => tenant.id === input.selectedTenantId)
    ? input.selectedTenantId : tenants[0]?.id ?? null;
  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId);
  const selectedPersonId = selectedTenant?.people.some((person) => person.id === input.selectedPersonId)
    ? input.selectedPersonId : selectedTenant?.people[0]?.id ?? null;
  return { schemaVersion: SCHEMA_VERSION, tags, tenants, selectedTenantId, selectedPersonId };
}

export function applyResolvedStaffId(workspace, tenantId, personId, staffId) {
  return applyResolvedPerson(workspace, tenantId, personId, { staffId });
}

export function applyResolvedPerson(workspace, tenantId, personId, resolved) {
  const normalized = normalizeWorkspace(workspace);
  const details = {
    staffId: text(resolved.staffId ?? "", "员工 ID", 150, true),
    code: text(resolved.code ?? "", "工号", 100),
    phone: text(resolved.phone ?? "", "手机号", 50),
    email: text(resolved.email ?? "", "邮箱", 254),
  };
  let foundTenant = false;
  let foundPerson = false;
  const tenants = normalized.tenants.map((tenant) => {
    if (tenant.id !== tenantId) return tenant;
    foundTenant = true;
    const people = tenant.people.map((person) => {
      if (person.id !== personId) return person;
      foundPerson = true;
      return {
        ...person,
        staffId: person.staffId || details.staffId,
        code: person.code || details.code,
        phone: person.phone || details.phone,
        email: person.email || details.email,
      };
    });
    return { ...tenant, people };
  });
  if (!foundTenant || !foundPerson) throw new Error("当前人员档案不存在，无法补齐人员信息");
  return { ...normalized, tenants };
}

export function createBackup(workspace) {
  const normalized = normalizeWorkspace(workspace);
  return JSON.stringify({ format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), ...normalized }, null, 2);
}

export function parseBackup(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  if (!isKnownBackupFormat(parsed?.format)) throw new Error("文件不是本工具导出的备份");
  return normalizeWorkspace(parsed);
}

// 合并只补充资料；无法可靠判定身份时停止，避免静默覆盖。
export function mergeBackup(current, backup, { makeTagId = () => crypto.randomUUID() } = {}) {
  const local = normalizeWorkspace(current);
  const incoming = normalizeWorkspace(backup);
  const assertUniqueCorporations = (tenants) => {
    if (new Set(tenants.map((item) => item.corporationId)).size !== tenants.length) {
      throw new Error("存在重复企业 ID，无法安全合并，请先整理租户资料");
    }
  };
  assertUniqueCorporations(local.tenants);
  assertUniqueCorporations(incoming.tenants);
  // 标签库按名称求并集，同名（忽略大小写与首尾空格）保留本地颜色；导入方 id 映射到合并后的 id。
  const tags = [...local.tags];
  const usedTagIds = new Set(tags.map((tag) => tag.id));
  const tagIdMap = new Map();
  for (const tag of incoming.tags) {
    const existing = tags.find((item) => sameTagName(item.name, tag.name));
    if (existing) {
      tagIdMap.set(tag.id, existing.id);
      continue;
    }
    // 名称不同但记录 ID 撞车：给导入的标签换一个新 ID，否则租户引用会指向本地另一个标签。
    let id = tag.id;
    if (usedTagIds.has(id)) {
      let attempt = 0;
      do {
        id = makeTagId();
        attempt += 1;
      } while (usedTagIds.has(id) && attempt < 10);
      if (usedTagIds.has(id)) throw new Error("标签记录 ID 冲突，无法安全合并");
    }
    usedTagIds.add(id);
    tagIdMap.set(tag.id, id);
    tags.push(id === tag.id ? tag : { ...tag, id });
  }
  const mergeTagIds = (target, source) => {
    const ids = [...(target || [])];
    for (const id of source || []) {
      const mapped = tagIdMap.get(id) ?? id;
      if (!ids.includes(mapped)) ids.push(mapped);
    }
    return ids;
  };
  const tenants = local.tenants.map((tenant) => ({
    ...tenant,
    tagIds: [...tenant.tagIds],
    people: tenant.people.map((person) => ({ ...person })),
  }));
  for (const source of incoming.tenants) {
    const byCorp = tenants.findIndex((item) => item.corporationId === source.corporationId);
    const byId = tenants.findIndex((item) => item.id === source.id);
    if (byId !== -1 && byId !== byCorp) throw new Error("租户记录 ID 对应不同企业，无法安全合并");
    if (byCorp === -1) {
      tenants.push({ ...source, tagIds: mergeTagIds([], source.tagIds) });
      continue;
    }
    const target = tenants[byCorp];
    target.tagIds = mergeTagIds(target.tagIds, source.tagIds);
    for (const person of source.people) {
      const byPersonId = target.people.findIndex((item) => item.id === person.id);
      const byStaffId = person.staffId ? target.people.findIndex((item) => item.staffId === person.staffId) : -1;
      if ((byPersonId !== -1 && byStaffId !== -1 && byPersonId !== byStaffId) ||
          (byPersonId !== -1 && target.people[byPersonId].staffId && person.staffId && target.people[byPersonId].staffId !== person.staffId)) {
        throw new Error(`租户“${target.name}”存在人员 ID 冲突，无法安全合并`);
      }
      const index = byStaffId !== -1 ? byStaffId : byPersonId;
      if (index === -1) target.people.push(person);
      else {
        const existing = target.people[index];
        target.people[index] = { ...existing, code: existing.code || person.code, phone: existing.phone || person.phone, email: existing.email || person.email, staffId: existing.staffId || person.staffId };
      }
    }
  }
  return normalizeWorkspace({ ...local, tags, tenants });
}

export async function loadWorkspace() {
  const storage = globalThis.chrome?.storage?.local;
  if (storage) {
    const saved = (await storage.get(STORAGE_KEY))[STORAGE_KEY];
    return saved ? normalizeWorkspace(saved) : emptyWorkspace();
  }
  if (import.meta.env.DEV) {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeWorkspace(JSON.parse(saved)) : demoWorkspace();
  }
  throw new Error("请从 Chrome/Edge 扩展页面打开此工具");
}

export async function prepareBackupImport(mode, backup, load = loadWorkspace) {
  if (mode === "replace") return normalizeWorkspace(backup);
  if (mode === "merge") return mergeBackup(await load(), backup);
  throw new Error("导入方式不正确");
}

export async function saveWorkspace(workspace) {
  const normalized = normalizeWorkspace(workspace);
  const storage = globalThis.chrome?.storage?.local;
  if (storage) await storage.set({ [STORAGE_KEY]: normalized });
  else if (import.meta.env.DEV) localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  else throw new Error("浏览器本地存储不可用");
  return normalized;
}

function demoWorkspace() {
  return normalizeWorkspace({
    schemaVersion: SCHEMA_VERSION,
    tags: [
      { id: "tag-demo-prod", name: "演示生产", color: "#d92d20" },
      { id: "tag-demo-test", name: "演示测试", color: "#b54708" },
    ],
    tenants: [{
      id: "demo-tenant", name: "演示企业", corporationId: "DEMO-CORP",
      baseUrl: "https://saas.example.com", deployment: "saas",
      appKey: "DEMO-APP-KEY", appSecurity: "DEMO-ONLY-NOT-A-SECRET",
      tagIds: ["tag-demo-prod"],
      people: [
        { id: "demo-1", name: "陈晨", staffId: "DEMO:10028", code: "10028", phone: "13800003268", email: "chenchen@example.com" },
        { id: "demo-2", name: "李明", staffId: "DEMO:10012", code: "10012", phone: "13900004321", email: "liming@example.com" },
        { id: "demo-3", name: "王芳", staffId: "DEMO:10039", code: "10039", phone: "13600008899", email: "wangfang@example.com" },
        { id: "demo-4", name: "张伟", staffId: "DEMO:10040", code: "10040", phone: "13800000040", email: "zhangwei@example.com" },
        { id: "demo-5", name: "刘洋", staffId: "DEMO:10041", code: "10041", phone: "13800000041", email: "liuyang@example.com" },
        { id: "demo-6", name: "赵敏", staffId: "DEMO:10042", code: "10042", phone: "13800000042", email: "zhaomin@example.com" },
        { id: "demo-7", name: "孙磊", staffId: "DEMO:10043", code: "10043", phone: "13800000043", email: "sunlei@example.com" },
        { id: "demo-8", name: "周静", staffId: "DEMO:10044", code: "10044", phone: "13800000044", email: "zhoujing@example.com" },
      ],
    }],
    selectedTenantId: "demo-tenant", selectedPersonId: "demo-1",
  });
}
