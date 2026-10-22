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
 */
export async function resolveStaffForTenants(tenants, form, resolve = resolveStaff) {
  const results = [];
  for (const tenant of tenants) {
    try {
      let person = { ...form };
      if (!String(person.name || "").trim()) {
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