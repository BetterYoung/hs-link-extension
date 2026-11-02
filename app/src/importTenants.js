import { SAAS_ORIGIN, isSaasOrigin } from "./config.js";
import { normalizeOrigin } from "./model.js";
import { cellText } from "./xlsx.js";

export const TENANT_IMPORT_LIMIT = 100;

const ALIASES = {
  name: ["租户名称", "名称", "租户", "tenantname", "tenant"],
  baseUrl: ["域名", "访问地址", "api地址", "api基础地址", "baseurl", "地址"],
  appKey: ["appkey", "接入账号", "应用key", "应用账号"],
  appSecurity: ["appsecurity", "接入密码", "密钥", "secret", "密码"],
};

const COLUMN_LABEL = {
  name: "租户名称",
  baseUrl: "域名",
  appKey: "appKey",
  appSecurity: "appSecurity",
};

/** 表头比较时忽略空格、全角括号与大小写。 */
function normalizeHeader(value) {
  return String(value ?? "").replace(/\s+/g, "").replace(/[（）()]/g, "").toLowerCase();
}

function findColumn(headerRow, aliases) {
  const keys = aliases.map(normalizeHeader);
  for (let index = 0; index < (headerRow?.length || 0); index += 1) {
    if (keys.includes(normalizeHeader(cellText(headerRow, index)))) return index;
  }
  return -1;
}

function isEmptyRow(row) {
  return !row?.some((item) => String(item?.value ?? "").trim());
}

function locateColumns(rows) {
  let best = null;
  for (let index = 0; index < Math.min(rows.length, 6); index += 1) {
    const columns = {};
    for (const key of Object.keys(ALIASES)) columns[key] = findColumn(rows[index], ALIASES[key]);
    const matched = Object.values(columns).filter((position) => position >= 0).length;
    if (matched >= 1 && (!best || matched > best.matched)) best = { headerIndex: index, columns, matched };
  }
  if (!best) throw new Error("未识别到表头，请使用「下载导入模板」提供的表格格式");
  const missing = Object.keys(COLUMN_LABEL).filter((key) => best.columns[key] < 0);
  if (missing.length) {
    throw new Error(`表头缺少列：${missing.map((key) => COLUMN_LABEL[key]).join("、")}。请使用「下载导入模板」提供的表格格式`);
  }
  return best;
}

/** 模板固定示例行：导入时自动跳过，不要求用户先删除。 */
export const TENANT_EXAMPLE = Object.freeze({
  name: "演示企业",
  baseUrl: "https://saas.example.com",
  appKey: "DEMO-APP-KEY",
  appSecurity: "DEMO-ONLY-NOT-A-SECRET",
});

function isExampleRow(row, columns) {
  return String(cellText(row, columns.name)).trim() === TENANT_EXAMPLE.name
    && String(cellText(row, columns.baseUrl)).trim() === TENANT_EXAMPLE.baseUrl
    && String(cellText(row, columns.appKey)).trim() === TENANT_EXAMPLE.appKey
    && String(cellText(row, columns.appSecurity)).trim() === TENANT_EXAMPLE.appSecurity;
}

/** 读取并校验租户表格：不联网，只产出逐行计划。 */
export function planTenantImport(rows, { existing = [], defaultOrigin = SAAS_ORIGIN, maxRows = TENANT_IMPORT_LIMIT } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("文件没有可读取的内容");
  const { headerIndex, columns } = locateColumns(rows);
  const dataRows = rows.slice(headerIndex + 1).filter((row) => !isEmptyRow(row));
  const exampleRows = [];
  const pending = [];
  dataRows.forEach((row, offset) => {
    const rowNumber = headerIndex + offset + 2;
    if (isExampleRow(row, columns)) {
      exampleRows.push(rowNumber);
      return;
    }
    pending.push({ row, rowNumber });
  });
  if (pending.length > maxRows) throw new Error(`一次最多导入 ${maxRows} 个租户，当前 ${pending.length} 行，请拆分后再导入`);
  if (!pending.length) throw new Error("表格里没有可导入的数据行（第 2 行示例数据会自动跳过）");

  const existingKeys = new Map(existing.map((tenant) => [`${tenant.baseUrl}|${tenant.appKey}`, tenant]));
  const seen = new Map();
  const items = [];

  for (const { row, rowNumber } of pending) {
    const name = cellText(row, columns.name).trim();
    const rawOrigin = cellText(row, columns.baseUrl).trim();
    const appKey = cellText(row, columns.appKey).trim();
    const appSecurity = cellText(row, columns.appSecurity).trim();
    const item = { rowNumber, name, baseUrl: "", deployment: "saas", appKey, appSecurity, status: "create" };

    const numericKey = [columns.appKey, columns.appSecurity].some((index) => row?.[index]?.numeric);
    if (numericKey) {
      item.status = "error";
      item.error = "接入账号或接入密码被 Excel 存成了数字，请把该列设为文本格式后重新导入";
      items.push(item);
      continue;
    }
    if (!name) {
      item.status = "error";
      item.error = "缺少租户名称";
      items.push(item);
      continue;
    }
    if (name.length > 100) {
      item.status = "error";
      item.error = "租户名称过长（最多 100 字）";
      items.push(item);
      continue;
    }
    if (!appKey) {
      item.status = "error";
      item.error = "缺少 appKey";
      items.push(item);
      continue;
    }
    if (!appSecurity) {
      item.status = "error";
      item.error = "缺少 appSecurity";
      items.push(item);
      continue;
    }
    if (appKey.length > 300 || appSecurity.length > 500) {
      item.status = "error";
      item.error = "接入账号或接入密码过长";
      items.push(item);
      continue;
    }
    if (rawOrigin) {
      try {
        item.baseUrl = normalizeOrigin(rawOrigin);
      } catch (error) {
        item.status = "error";
        item.error = error.message;
        items.push(item);
        continue;
      }
    } else {
      item.baseUrl = defaultOrigin;
    }
    item.deployment = isSaasOrigin(item.baseUrl) ? "saas" : "onPrem";

    const key = `${item.baseUrl}|${item.appKey}`;
    if (seen.has(key)) {
      item.status = "skip";
      item.duplicateOf = seen.get(key);
      item.error = `与第 ${seen.get(key)} 行的域名和 appKey 重复，已跳过`;
      items.push(item);
      continue;
    }
    seen.set(key, rowNumber);
    if (existingKeys.has(key)) item.status = "update";
    items.push(item);
  }

  return { items, headerIndex, exampleRows };
}

/**
 * 把已授权成功的行合并进工作区：按企业 ID 识别同一租户，命中则覆盖资料并保留人员与记录 ID。
 */
export function mergeTenantImport(workspace, executed, { makeId = () => crypto.randomUUID() } = {}) {
  const tenants = [...workspace.tenants];
  const added = [];
  const updated = [];
  const failed = [];
  const seenCorporationIds = new Map();

  for (const entry of executed) {
    const item = entry.item;
    if (entry.error) {
      failed.push({ rowNumber: item.rowNumber, name: item.name, error: entry.error });
      continue;
    }
    const corporationId = String(entry.corporationId || "").trim();
    if (!corporationId) {
      failed.push({ rowNumber: item.rowNumber, name: item.name, error: "授权响应缺少企业 ID" });
      continue;
    }
    if (seenCorporationIds.has(corporationId)) {
      failed.push({ rowNumber: item.rowNumber, name: item.name, error: `与第 ${seenCorporationIds.get(corporationId)} 行的企业 ID 相同，已跳过` });
      continue;
    }
    seenCorporationIds.set(corporationId, item.rowNumber);

    const index = tenants.findIndex((tenant) => tenant.corporationId === corporationId);
    if (index >= 0) {
      const existing = tenants[index];
      const merged = {
        ...existing,
        name: item.name,
        baseUrl: item.baseUrl,
        deployment: item.deployment,
        appKey: item.appKey,
        appSecurity: item.appSecurity,
        corporationId,
      };
      tenants[index] = merged;
      updated.push({ rowNumber: item.rowNumber, name: merged.name, id: merged.id });
      continue;
    }
    const created = {
      id: makeId(),
      name: item.name,
      corporationId,
      baseUrl: item.baseUrl,
      deployment: item.deployment,
      appKey: item.appKey,
      appSecurity: item.appSecurity,
      people: [],
    };
    tenants.push(created);
    added.push({ rowNumber: item.rowNumber, name: created.name, id: created.id });
  }

  const selectedTenantId = workspace.selectedTenantId || added[0]?.id || null;
  return {
    ...workspace,
    tenants,
    selectedTenantId,
    selectedPersonId: tenants.find((tenant) => tenant.id === selectedTenantId)?.people.some((person) => person.id === workspace.selectedPersonId)
      ? workspace.selectedPersonId
      : tenants.find((tenant) => tenant.id === selectedTenantId)?.people[0]?.id ?? null,
    added,
    updated,
    failed,
    changed: added.length + updated.length > 0,
  };
}

/** 租户导入模板：数据表 + 填写说明。第 2 行固定为示例数据，导入时自动跳过。 */
export function tenantTemplateSheets() {
  return [
    {
      name: "租户",
      rows: [
        ["租户名称", "域名", "appKey", "appSecurity"],
        [TENANT_EXAMPLE.name, TENANT_EXAMPLE.baseUrl, TENANT_EXAMPLE.appKey, TENANT_EXAMPLE.appSecurity],
      ],
      widths: [20, 30, 26, 30],
      textColumns: [2, 3],
    },
    {
      name: "填写说明",
      rows: [
        ["1. 第 2 行是示例数据，导入时会自动跳过，直接在下方填写真实租户即可。"],
        ["2. 「域名」填写裸 HTTPS 源，不含路径、账号与参数；SaaS 部署可留空，导入时使用内置地址。"],
        ["3. 企业 ID 不需要填写，导入时会调用授权接口自动获取；凭据错误或企业 ID 不一致的行会被跳过。"],
        ["4. appKey、appSecurity 列已设为文本格式，请勿改成数值，否则凭据会被 Excel 截断。"],
        ["5. 一次最多导入 100 行；同一域名与 appKey 重复的行只会保留第一行。"],
      ],
    },
  ];
}
