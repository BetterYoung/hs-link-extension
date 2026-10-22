import { normalizeOrigin } from "./model.js";
import { isSaasOrigin } from "./config.js";

export class PermissionRequiredError extends Error {
  constructor(origin) {
    super(`需要授权访问 ${origin}`);
    this.name = "PermissionRequiredError";
    this.origin = origin;
  }
}

export function permissionPattern(origin) {
  return `${normalizeOrigin(origin)}/*`;
}

export async function hasOriginPermission(origin, browser = globalThis.chrome) {
  if (!browser?.permissions) throw new Error("仅能在 Chrome/Edge 扩展中请求 API 域名权限");
  return browser.permissions.contains({ origins: [permissionPattern(origin)] });
}

export async function requestOriginPermission(origin, browser = globalThis.chrome) {
  if (!browser?.permissions) throw new Error("仅能在 Chrome/Edge 扩展中请求 API 域名权限");
  const granted = await browser.permissions.request({ origins: [permissionPattern(origin)] });
  if (!granted) throw new Error(`未授予 ${origin} 的访问权限`);
}

async function requestJson(fetchImpl, url, { method = "GET", body, stage }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchImpl(url, {
      method,
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${stage}失败（HTTP ${response.status}）`);
    try {
      return await response.json();
    } catch {
      throw new Error(`${stage}返回的数据不是 JSON`);
    }
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`${stage}超时，请检查网络`);
    if (error instanceof TypeError) throw new Error(`${stage}网络请求失败，请检查地址和域名权限`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 授权租户：申请域名权限并换取 accessToken。
 * 企业 ID 允许留空，留空时使用授权响应中的 corporationId；
 * 已填写且与授权返回不一致时中止。
 */
export async function authorizeTenant(tenant, {
  fetchImpl = fetch,
  requestPermission = requestOriginPermission,
} = {}) {
  let origin = normalizeOrigin(tenant.baseUrl);
  await requestPermission(origin);
  if (tenant.deployment === "saas" && String(tenant.corporationId || "").trim()) {
    const locationUrl = new URL("/api/openapi/v2/location", origin);
    locationUrl.searchParams.set("corpId", tenant.corporationId);
    const location = await requestJson(fetchImpl, locationUrl, { stage: "获取地址前缀" });
    if (typeof location?.value !== "string") throw new Error("地址前缀响应缺少 value");
    origin = normalizeOrigin(location.value);
    await requestPermission(origin);
  }
  const auth = await requestJson(fetchImpl, new URL("/api/openapi/v1/auth/getAccessToken", origin), {
    method: "POST", stage: "获取授权",
    body: { appKey: tenant.appKey, appSecurity: tenant.appSecurity },
  });
  const accessToken = auth?.value?.accessToken;
  const corporationId = typeof auth?.value?.corporationId === "string" ? auth.value.corporationId.trim() : "";
  if (typeof accessToken !== "string" || !accessToken) throw new Error("获取授权响应缺少 accessToken");
  if (!corporationId) throw new Error("获取授权响应缺少 corporationId");
  const configured = String(tenant.corporationId || "").trim();
  if (configured && corporationId !== configured) {
    throw new Error("授权返回的企业 ID 与当前租户不一致，已停止保存");
  }
  return { accessToken, corporationId, origin };
}

/**
 * 按人员 ID → 工号 → 手机号 → 邮箱的顺序匹配员工，返回姓名与档案字段。
 */
export async function resolveStaff(tenant, person, {
  fetchImpl = fetch,
  authorize = authorizeTenant,
  noConditionError = "请填写人员 ID、工号、手机号或邮箱之一，以便匹配员工姓名",
} = {}) {
  const conditions = [
    person.staffId && ["STAFFID", String(person.staffId).trim()],
    person.code && ["CODE", String(person.code).trim()],
    person.phone && ["CELLPHONE", String(person.phone).trim()],
    person.email && ["MAIL", String(person.email).trim()],
  ].filter((condition) => condition && condition[1]);
  if (!conditions.length) throw new Error(noConditionError);
  const { accessToken, origin } = await authorize(tenant);
  for (const [type, condition] of conditions) {
    const staffUrl = new URL("/api/openapi/v1/staffs/getStaffIds", origin);
    staffUrl.searchParams.set("accessToken", accessToken);
    const staff = await requestJson(fetchImpl, staffUrl, {
      method: "POST", stage: "查询员工",
      body: { type, conditionIds: [condition] },
    });
    if (!Array.isArray(staff?.items)) throw new Error("员工查询响应缺少 items");
    if (staff.items.length > 1) throw new Error("员工查询结果不唯一，请核对人员 ID、工号、手机号或邮箱");
    if (staff.items.length === 1) {
      const item = staff.items[0];
      if (typeof item?.id !== "string" || !item.id.trim()) throw new Error("员工查询响应缺少 ID");
      const name = typeof item.name === "string" ? item.name.trim()
        : typeof item.staffName === "string" ? item.staffName.trim() : "";
      if (!name) throw new Error("员工查询响应缺少姓名");
      return {
        name,
        staffId: item.id.trim(),
        code: typeof item.code === "string" ? item.code.trim() : "",
        phone: typeof item.cellphone === "string" ? item.cellphone.trim() : "",
        email: typeof item.email === "string" ? item.email.trim() : "",
      };
    }
  }
  throw new Error("未找到员工，请核对人员 ID、工号、手机号或邮箱");
}

/**
 * 解析浏览器复制的 cURL 命令，取出访问地址、接入账号与接入密码。
 * 只读取 --url 与 --data/-d，Cookie、User-Agent 等请求头不会进入返回值。
 */
export function parseCurlCommand(input) {
  const text = String(input || "").replace(/\\\r?\n/g, " ").replace(/\^\r?\n/g, " ");
  if (!text.trim()) throw new Error("请粘贴 cURL 命令");
  const urlMatch = text.match(/(?:^|\s)--url\s+(?:'([^']*)'|"([^"]*)"|([^\s\\]+))/i);
  const fallbackMatch = text.match(/(?:^|\s)curl(?:\.exe)?\b[\s\S]*?\s(?:'|")?(https:\/\/[^\s'"]+)/i);
  const rawUrl = urlMatch ? urlMatch[1] ?? urlMatch[2] ?? urlMatch[3] : fallbackMatch?.[1];
  if (!rawUrl) throw new Error("未在 cURL 中找到访问地址（--url）");
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("cURL 中的访问地址无效");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("cURL 中的访问地址必须是不含账号密码的 HTTPS 地址");
  }
  const dataMatch = text.match(/(?:^|\s)(?:--data(?:-raw|-binary|-urlencode)?|-d)\s+(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|([^\s\\]+))/i);
  if (!dataMatch) throw new Error("未在 cURL 中找到请求体（--data 或 -d）");
  const rawBody = (dataMatch[1] ?? dataMatch[2] ?? dataMatch[3] ?? "").replace(/\\(["'\\])/g, "$1");
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new Error("cURL 请求体不是有效的 JSON");
  }
  const appKey = typeof body?.appKey === "string" ? body.appKey.trim() : "";
  const appSecurity = typeof body?.appSecurity === "string" ? body.appSecurity.trim() : "";
  if (!appKey) throw new Error("cURL 请求体缺少 appKey");
  if (!appSecurity) throw new Error("cURL 请求体缺少 appSecurity");
  return {
    baseUrl: url.origin,
    appKey,
    appSecurity,
    deployment: isSaasOrigin(url.origin) ? "saas" : "onPrem",
  };
}

export async function generateAccessLink(tenant, person, {
  fetchImpl = fetch,
  checkPermission = hasOriginPermission,
  onStep = () => {},
} = {}) {
  const configuredOrigin = normalizeOrigin(tenant.baseUrl);
  let apiOrigin = configuredOrigin;

  if (tenant.deployment === "saas") {
    onStep("获取地址前缀");
    const locationUrl = new URL("/api/openapi/v2/location", configuredOrigin);
    locationUrl.searchParams.set("corpId", tenant.corporationId);
    const location = await requestJson(fetchImpl, locationUrl, { stage: "获取地址前缀" });
    if (typeof location?.value !== "string") throw new Error("地址前缀响应缺少 value");
    apiOrigin = normalizeOrigin(location.value);
    if (!(await checkPermission(apiOrigin))) throw new PermissionRequiredError(apiOrigin);
  }

  onStep("获取授权");
  const auth = await requestJson(fetchImpl, new URL("/api/openapi/v1/auth/getAccessToken", apiOrigin), {
    method: "POST", stage: "获取授权",
    body: { appKey: tenant.appKey, appSecurity: tenant.appSecurity },
  });
  const accessToken = auth?.value?.accessToken;
  if (typeof accessToken !== "string" || !accessToken) throw new Error("获取授权响应缺少 accessToken");
  if (auth.value.corporationId !== tenant.corporationId) {
    throw new Error("授权返回的企业 ID 与当前租户不一致，已停止生成");
  }

  let staffId = person.staffId;
  let resolvedPerson = null;
  if (!person.staffId || !person.code || !person.phone || !person.email) {
    const conditions = [
      person.staffId && ["STAFFID", person.staffId],
      person.code && ["CODE", person.code],
      person.phone && ["CELLPHONE", person.phone],
      person.email && ["MAIL", person.email],
    ].filter(Boolean);
    if (!conditions.length) throw new Error("请填写员工 ID、工号、手机号或邮箱");
    for (const [type, condition] of conditions) {
      onStep(type === "STAFFID" ? "按人员 ID 查询员工"
        : type === "CODE" ? "按工号查询员工"
        : type === "CELLPHONE" ? "按手机号查询员工"
        : "按邮箱查询员工");
      const staffUrl = new URL("/api/openapi/v1/staffs/getStaffIds", apiOrigin);
      staffUrl.searchParams.set("accessToken", accessToken);
      const staff = await requestJson(fetchImpl, staffUrl, {
        method: "POST", stage: "查询员工",
        body: { type, conditionIds: [condition] },
      });
      if (!Array.isArray(staff?.items)) throw new Error("员工查询响应缺少 items");
      if (staff.items.length > 1) throw new Error("员工查询结果不唯一，请核对人员 ID、工号、手机号或邮箱");
      if (staff.items.length === 1) {
        const item = staff.items[0];
        if (typeof item?.id !== "string" || !item.id.trim()) throw new Error("员工查询响应缺少 ID");
        staffId = item.id.trim();
        resolvedPerson = {
          staffId,
          code: typeof item.code === "string" ? item.code.trim() : "",
          phone: typeof item.cellphone === "string" ? item.cellphone.trim() : "",
          email: typeof item.email === "string" ? item.email.trim() : "",
        };
        break;
      }
    }
    if (!resolvedPerson) throw new Error("未找到员工，请核对人员 ID、工号、手机号或邮箱");
  }

  onStep("生成临时授权");
  const provisionalUrl = new URL("/api/openapi/v1.1/provisional/getProvisionalAuth", apiOrigin);
  provisionalUrl.searchParams.set("accessToken", accessToken);
  const provisional = await requestJson(fetchImpl, provisionalUrl, {
    method: "POST", stage: "生成临时授权",
    body: { uid: staffId, pageType: "frontPage", expireDate: "604800", isApplet: false },
  });
  const value = provisional?.value;
  if (!value || (value.code !== "true" && value.code !== true) || typeof value.message !== "string") {
    throw new Error("临时授权未成功，请核对员工状态与接口权限");
  }
  let target;
  try {
    target = new URL(value.message);
  } catch {
    throw new Error("临时授权返回了无效链接");
  }
  if (target.protocol !== "https:") throw new Error("临时授权返回的链接不是 HTTPS 地址");
  return { url: target.href, resolvedStaffId: staffId, resolvedPerson, apiOrigin };
}