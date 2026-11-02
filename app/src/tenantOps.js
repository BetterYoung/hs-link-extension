import { normalizePerson } from "./model.js";
import { resolveStaff } from "./openapi.js";

/**
 * 同一租户内按人员 ID（staffId）去重：命中已有记录时更新该记录，并保留其记录 ID。
 */
export function upsertPerson(people, person) {
  const staffId = String(person.staffId || "").trim();
  if (!staffId) return { person, people: [...people, person] };
  const index = people.findIndex((item) => item.staffId && item.staffId === staffId);
  if (index < 0) return { person, people: [...people, person] };
  const existing = people[index];
  const merged = { ...existing, ...person, id: existing.id };
  return { person: merged, people: people.map((item, position) => (position === index ? merged : item)) };
}

/**
 * 批量新增人员：按租户逐一匹配员工；姓名为空时用该租户凭证匹配，匹配失败的租户自动跳过。
 * `alwaysResolve` 为 Excel 导入使用：无论姓名是否填写都查询人员 ID，并校验表格中的 ID。
 */
export async function resolveStaffForTenants(tenants, form, resolve = resolveStaff, { alwaysResolve = false } = {}) {
  const results = [];
  for (const tenant of tenants) {
    try {
      let person = { ...form };
      if (alwaysResolve) {
        const resolved = await resolve(tenant, person);
        const staffId = String(resolved?.staffId || "").trim();
        if (!staffId) throw new Error("未查询到人员 ID，无法导入该行");
        const filedStaffId = String(person.staffId || "").trim();
        if (filedStaffId && filedStaffId !== staffId) {
          throw new Error(`人员 ID 与查询结果不一致（查询得到 ${staffId}），请核对后再导入`);
        }
        person = {
          ...person,
          name: String(person.name || "").trim() || resolved.name,
          staffId,
          code: String(person.code || "").trim() || resolved.code,
          phone: String(person.phone || "").trim() || resolved.phone,
          email: String(person.email || "").trim() || resolved.email,
        };
      } else if (!String(person.name || "").trim()) {
        const resolved = await resolve(tenant, person);
        person = {
          ...person,
          name: resolved.name,
          staffId: String(person.staffId || "").trim() || resolved.staffId,
          code: String(person.code || "").trim() || resolved.code,
          phone: String(person.phone || "").trim() || resolved.phone,
          email: String(person.email || "").trim() || resolved.email,
        };
      }
      results.push({ tenantId: tenant.id, tenantName: tenant.name, person });
    } catch (error) {
      results.push({ tenantId: tenant.id, tenantName: tenant.name, error: error?.message || String(error) });
    }
  }
  return results;
}

const defaultMakeId = () => globalThis.crypto?.randomUUID?.() ?? `person-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * 把一批人员表单写入若干租户：批量新增（1 人）× 多人导入（N 人）共用。
 * 每个表单在多个租户间共享同一个记录 ID；同租户内仍按 staffId 去重并保留原记录 ID。
 * 单个（人 × 租户）失败只记录错误，不中断整批；`signal.aborted` 为真时提前结束并保留已完成结果。
 */
export async function savePeopleToTenants(tenants, forms, {
  resolve = resolveStaff,
  makeId = defaultMakeId,
  onProgress = () => {},
  signal,
  alwaysResolve = false,
} = {}) {
  const peopleByTenant = new Map();
  const results = [];
  const tenantsById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const finish = (aborted) => ({
    tenants: tenants.map((tenant) => peopleByTenant.has(tenant.id) ? { ...tenant, people: peopleByTenant.get(tenant.id) } : tenant),
    results,
    aborted,
  });

  for (let index = 0; index < forms.length; index += 1) {
    if (signal?.aborted) return finish(true);
    const form = forms[index];
    const sharedId = makeId();
    onProgress({ index, total: forms.length, personName: form.name || "" });
    const perTenant = await resolveStaffForTenants(tenants, form, resolve, { alwaysResolve });
    for (const item of perTenant) {
      const base = {
        rowIndex: index, personId: sharedId, personName: form.name || "",
        tenantId: item.tenantId, tenantName: item.tenantName,
      };
      if (item.error) {
        results.push({ ...base, ok: false, error: item.error });
        continue;
      }
      try {
        const person = normalizePerson({ ...item.person, id: sharedId });
        const target = tenantsById.get(item.tenantId);
        if (!target) throw new Error("当前租户已不存在，无法保存人员");
        const current = peopleByTenant.get(item.tenantId) ?? target.people;
        const upserted = upsertPerson(current, person);
        peopleByTenant.set(item.tenantId, upserted.people);
        results.push({ ...base, ok: true, personId: upserted.person.id, personName: person.name });
      } catch (error) {
        results.push({ ...base, ok: false, error: error?.message || String(error) });
      }
    }
  }
  return finish(false);
}

/** 把（人 × 租户）结果按人员行分组，供导入结果弹窗展示。 */
export function groupResultsByPerson(results) {
  const groups = new Map();
  for (const item of results) {
    if (!groups.has(item.rowIndex)) {
      groups.set(item.rowIndex, {
        rowIndex: item.rowIndex, personId: item.personId,
        personName: item.personName, items: [],
      });
    }
    groups.get(item.rowIndex).items.push(item);
  }
  return [...groups.values()];
}
