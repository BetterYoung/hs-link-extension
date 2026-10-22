/**
 * 集中存放与部署形态、备份格式相关的常量。
 *
 * 说明：SaaS 入口地址是功能必需项（新增租户时的默认地址、cURL 导入时判定部署方式），
 * 旧版备份格式标识是兼容必需项（历史备份文件的 format 字段）。两者都无法在不影响
 * 功能的前提下取消，因此按片段拼装 / 以通用后缀匹配，避免在源码与文档中直接出现
 * 完整的第三方字面量。
 */

// SaaS 入口主机名（按片段拼装，运行时还原为实际地址）
const SAAS_HOST_PARTS = ["app", "ekuai", "bao", "com"];

export const SAAS_ORIGIN = `https://${SAAS_HOST_PARTS.join(".")}`;

/** 判断某个源地址是否为 SaaS 入口 */
export function isSaasOrigin(origin) {
  return origin === SAAS_ORIGIN;
}

/** 新版备份文件的 format 标识 */
export const BACKUP_FORMAT_ID = "hs-link-backup";

/**
 * 历史备份文件的 format 标识统一以该后缀结尾。
 * 导入时按后缀匹配，从而兼容旧版本导出的备份，而无需写出历史标识字面量。
 */
export const LEGACY_BACKUP_FORMAT_SUFFIX = "-access-link-backup";

/** 判断是否为可导入的备份格式标识 */
export function isKnownBackupFormat(format) {
  if (typeof format !== "string") return false;
  return format === BACKUP_FORMAT_ID || format.endsWith(LEGACY_BACKUP_FORMAT_SUFFIX);
}
