import { useEffect, useRef, useState } from "react";
import { Download, Eye, EyeOff, FileUp, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { createBackup, emptyWorkspace, loadWorkspace, normalizePerson, normalizeTenant, parseBackup, saveWorkspace, STORAGE_KEY } from "./model.js";
import { authorizeTenant, createTenantAuthorizer, parseCurlCommand, requestOriginPermissions, resolveStaff } from "./openapi.js";
import { PeopleView } from "./PeopleView.jsx";
import { ImportPreview } from "./ImportPreview.jsx";
import { planPersonImport, personTemplateSheets, PERSON_IMPORT_LIMIT } from "./importPeople.js";
import { mergeTenantImport, planTenantImport, tenantTemplateSheets, TENANT_IMPORT_LIMIT } from "./importTenants.js";
import { savePeopleToTenants, groupResultsByPerson, upsertPerson } from "./tenantOps.js";
import { buildWorkbook, pickSheet, readSheets, XLSX_MIME } from "./xlsx.js";
import { SAAS_ORIGIN } from "./config.js";

const SAAS_DEFAULT_ORIGIN = SAAS_ORIGIN;
const IMPORT_FILE_LIMIT = 5 * 1024 * 1024;
const blankTenant = { name: "", corporationId: "", baseUrl: SAAS_DEFAULT_ORIGIN, deployment: "saas", appKey: "", appSecurity: "" };
const blankPerson = { name: "", staffId: "", code: "", phone: "", email: "" };

function downloadBytes(filename, bytes) {
  const blob = new Blob([bytes], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Field({ label, ...props }) {
  return <label className="field"><span>{label}</span><input {...props} /></label>;
}

function Modal({ title, children, onClose, footer, error, wide }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`modal${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button type="button" className="icon-button" title="关闭" aria-label="关闭" onClick={onClose}><X size={20} /></button></header>
      <div className="modal-body">{error && <p className="modal-error" role="alert">{error}</p>}{children}</div>
      <footer>{footer}</footer>
    </section>
  </div>;
}

function DetailField({ label, children, className = "" }) {
  return <div className={`detail-field ${className}`}><span>{label}</span><div>{children}</div></div>;
}

/** 批量新增人员时的租户多选器：默认全选，支持按名称搜索。 */
function BatchTenantPicker({ tenants, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const selected = new Set(value);
  const term = query.trim().toLocaleLowerCase();
  const filtered = tenants.filter((tenant) => tenant.name.toLocaleLowerCase().includes(term));
  const allSelected = tenants.length > 0 && tenants.every((tenant) => selected.has(tenant.id));
  const filteredSelected = filtered.length > 0 && filtered.every((tenant) => selected.has(tenant.id));
  const single = value.length === 1 ? tenants.find((tenant) => tenant.id === value[0]) : null;
  let label = "请选择租户";
  if (allSelected) label = `全部租户（${tenants.length} 个）`;
  else if (single) label = single.name;
  else if (value.length > 0) label = `已选择 ${value.length} / ${tenants.length} 个租户`;

  return <div className="batch-tenant-picker" ref={rootRef}>
    <button type="button" className="batch-tenant-trigger" aria-expanded={open} aria-haspopup="group" onClick={() => setOpen(!open)}>
      <span>{label}</span><span className="batch-tenant-arrow" aria-hidden="true">{open ? "▴" : "▾"}</span>
    </button>
    {open && <div className="batch-tenant-panel" role="group" aria-label="选择租户">
      <input className="batch-tenant-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索租户名称" aria-label="搜索租户名称" autoFocus />
      <label className="batch-tenant-option batch-tenant-all">
        <input type="checkbox" checked={filteredSelected} onChange={(event) => {
          const ids = new Set(filtered.map((tenant) => tenant.id));
          onChange(event.target.checked ? [...new Set([...value, ...ids])] : value.filter((id) => !ids.has(id)));
        }} />
        <span>全选当前结果</span>
      </label>
      {filtered.map((tenant) => <label className="batch-tenant-option" key={tenant.id}>
        <input type="checkbox" checked={selected.has(tenant.id)} onChange={(event) => onChange(event.target.checked ? [...value, tenant.id] : value.filter((id) => id !== tenant.id))} />
        <span>{tenant.name}</span><small>{tenant.deployment === "saas" ? "SaaS" : "本地化"}</small>
      </label>)}
      {filtered.length === 0 && <p className="batch-tenant-empty">没有匹配的租户</p>}
    </div>}
  </div>;
}

/** 人员五个字段，手动填写与导入两种来源共用。 */
function PersonFields({ form, onChange }) {
  return <>
    <Field label="姓名" value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} placeholder="留空后从员工信息自动回填" />
    <Field label="人员 ID" value={form.staffId} onChange={(event) => onChange({ ...form, staffId: event.target.value })} />
    <Field label="工号（Code）" value={form.code} onChange={(event) => onChange({ ...form, code: event.target.value })} />
    <Field label="手机号" type="tel" value={form.phone} onChange={(event) => onChange({ ...form, phone: event.target.value })} />
    <Field label="邮箱" type="email" value={form.email} onChange={(event) => onChange({ ...form, email: event.target.value })} />
  </>;
}

function PersonImportPreview({ plan, selectedTenantCount, busy, progress }) {
  const okItems = plan.items.filter((item) => item.status === "ok" || item.status === "warn");
  const invalid = plan.items.length - okItems.length;
  const rows = plan.items.map((item) => ({
    key: `person-row-${item.rowNumber}`,
    tone: item.status === "error" ? "error" : item.status === "skip" ? "skip" : item.status === "warn" ? "warn" : "ok",
    cells: [
      item.rowNumber,
      item.form.name || "（空）",
      item.form.staffId || "—",
      item.form.code || "—",
      item.form.phone || "—",
      item.form.email || "—",
      item.error || item.warning || "待查询人员 ID",
    ],
  }));
  return <>
    <p className="import-summary">共 {plan.items.length} 行：可导入 <strong>{okItems.length}</strong> 行，跳过或错误 <strong>{invalid}</strong> 行；将写入 {okItems.length} × {selectedTenantCount} 个租户 = <strong>{okItems.length * selectedTenantCount}</strong> 条档案。</p>
    {plan.exampleRows?.length ? <p className="form-note">已自动跳过第 {plan.exampleRows.join("、")} 行的示例数据。</p> : null}
    {busy && progress && <p className="import-progress">正在导入 第 {progress.done} / {progress.total} 人…</p>}
    <ImportPreview label="人员导入预览" headers={["行", "姓名", "人员 ID", "工号", "手机号", "邮箱", "状态"]} rows={rows} />
  </>;
}

function TenantImportPreview({ plan, busy, progress }) {
  const okItems = plan.items.filter((item) => item.status === "create" || item.status === "update");
  const invalid = plan.items.length - okItems.length;
  const label = { create: "新增", update: "更新", skip: "跳过", error: "错误" };
  const rows = plan.items.map((item) => ({
    key: `tenant-row-${item.rowNumber}`,
    tone: item.status,
    cells: [
      item.rowNumber,
      item.name || "（空）",
      item.baseUrl || "—",
      item.appKey || "—",
      `${label[item.status]}${item.error ? `：${item.error}` : ""}`,
    ],
  }));
  return <>
    <p className="import-summary">共 {plan.items.length} 行：可导入 <strong>{okItems.length}</strong> 行（新增 {plan.items.filter((item) => item.status === "create").length}、更新 {plan.items.filter((item) => item.status === "update").length}），跳过或错误 <strong>{invalid}</strong> 行。</p>
    {plan.exampleRows?.length ? <p className="form-note">已自动跳过第 {plan.exampleRows.join("、")} 行的示例数据。</p> : null}
    {busy && progress && <p className="import-progress">正在处理 第 {progress.done} / {progress.total} 个租户…</p>}
    <ImportPreview label="租户导入预览" headers={["行", "租户名称", "域名", "appKey", "状态"]} rows={rows} />
  </>;
}

function failureText(list) {
  return (list || []).map((item) => `第 ${item.rowNumber} 行${item.name ? ` ${item.name}` : ""}${item.error ? `：${item.error}` : ""}`).join("\n");
}

/** 导入人员结果：按人员行分组，只展开失败明细。 */
function PersonResultBody({ result }) {
  const groups = groupResultsByPerson(result.results);
  const okCount = result.results.filter((item) => item.ok).length;
  const failCount = result.results.length - okCount;
  const rowNumbers = result.rowNumbers || [];
  const rowLabel = (group) => rowNumbers[group.rowIndex] ?? group.rowIndex + 1;
  return <div className="global-result-summary">
    <p>共 {groups.length} 人，写入 <strong>{okCount}</strong> 条档案，失败 <strong>{failCount}</strong> 条{result.aborted ? "（已中止，已完成部分已保存）" : ""}{result.invalid?.length ? `；另有 ${result.invalid.length} 行未执行` : ""}。</p>
    {groups.map((group) => {
      const failed = group.items.filter((item) => !item.ok);
      return <section className="global-result-section" key={group.personId}>
        <h3>第 {rowLabel(group)} 行 {group.personName || "（未匹配姓名）"}（成功 {group.items.length - failed.length}/{group.items.length}）</h3>
        {failed.length
          ? <ul className="global-result-list">{failed.map((item) => <li key={item.tenantId}><strong>{item.tenantName}</strong><span>{item.error}</span></li>)}</ul>
          : <p className="form-note">全部成功</p>}
      </section>;
    })}
    {result.invalid?.length ? <section className="global-result-section global-result-failed">
      <h3>未执行行（{result.invalid.length}）</h3>
      <ul className="global-result-list">{result.invalid.map((item) => <li key={item.rowNumber}><strong>第 {item.rowNumber} 行</strong><span>{item.error}</span></li>)}</ul>
    </section> : null}
  </div>;
}

export function App() {
  const [workspace, setWorkspace] = useState(null);
  const [tenantQuery, setTenantQuery] = useState("");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const [saving, setSaving] = useState(false);
  const [curlText, setCurlText] = useState("");
  const [batchResult, setBatchResult] = useState(null);
  const [batchTenantIds, setBatchTenantIds] = useState([]);
  // 人员导入：与批量新增共用同一个对话框，仅切换数据来源。
  const [personSource, setPersonSource] = useState("manual");
  const [personPlan, setPersonPlan] = useState(null);
  const [personFileName, setPersonFileName] = useState("");
  const [personImportError, setPersonImportError] = useState("");
  const [personImportBusy, setPersonImportBusy] = useState(false);
  const [personImportProgress, setPersonImportProgress] = useState(null);
  // 租户导入：独立对话框，走授权回填企业 ID。
  const [tenantPlan, setTenantPlan] = useState(null);
  const [tenantFileName, setTenantFileName] = useState("");
  const [tenantImportError, setTenantImportError] = useState("");
  const [tenantImportBusy, setTenantImportBusy] = useState(false);
  const [tenantImportProgress, setTenantImportProgress] = useState(null);
  const [tenantResult, setTenantResult] = useState(null);
  const [copiedList, setCopiedList] = useState(false);
  const importAbort = useRef(false);
  const tenantFileInput = useRef(null);
  const personFileInput = useRef(null);
  const fileInput = useRef(null);
  const writeQueue = useRef(Promise.resolve());
  // 弹窗可以新增人员，设置页在对话框关闭时同步外部写入，避免旧快照覆盖。
  const [externalWorkspace, setExternalWorkspace] = useState(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    dialogRef.current = dialog;
  }, [dialog]);

  useEffect(() => {
    loadWorkspace().then(setWorkspace).catch((error) => {
      setNotice(error.message);
      setWorkspace(emptyWorkspace());
    });
  }, []);

  useEffect(() => {
    let active = true;
    const onChanged = (changes, area) => {
      if (area !== "local" || !changes?.[STORAGE_KEY]) return;
      loadWorkspace().then((next) => {
        if (!active) return;
        if (dialogRef.current) {
          // 对话框打开时立即同步资料数据，但保留当前选中项，避免误保存到被切换的租户。
          setExternalWorkspace(next);
          setWorkspace((current) => current ? {
            ...next,
            selectedTenantId: current.selectedTenantId,
            selectedPersonId: current.selectedPersonId,
          } : next);
        } else {
          setWorkspace(next);
        }
      }).catch(() => {});
    };
    globalThis.chrome?.storage?.onChanged?.addListener(onChanged);
    return () => {
      active = false;
      globalThis.chrome?.storage?.onChanged?.removeListener(onChanged);
    };
  }, []);

  useEffect(() => {
    if (dialog === null && externalWorkspace) {
      setWorkspace(externalWorkspace);
      setExternalWorkspace(null);
    }
  }, [dialog, externalWorkspace]);

  const tenant = workspace?.tenants.find((item) => item.id === workspace.selectedTenantId);
  const personFailureText = batchResult?.results
    ? groupResultsByPerson(batchResult.results).flatMap((group) => group.items
      .filter((item) => !item.ok)
      .map((item) => `第 ${(batchResult.rowNumbers || [])[group.rowIndex] ?? group.rowIndex + 1} 行 ${group.personName || ""} @ ${item.tenantName}：${item.error}`))
      .join("\n")
    : "";
  const personToDelete = tenant?.people.find((item) => item.id === form?.id);
  const normalizedTenantQuery = tenantQuery.trim().toLocaleLowerCase();
  const visibleTenants = workspace?.tenants.filter((item) => [item.name, item.corporationId]
    .some((value) => value.toLocaleLowerCase().includes(normalizedTenantQuery))) ?? [];

  function persist(next) {
    setWorkspace(next);
    setNotice("");
    writeQueue.current = writeQueue.current.catch(() => {}).then(() => saveWorkspace(next));
    writeQueue.current.catch((error) => setNotice(`保存失败：${error.message}`));
  }

  function selectTenant(id) {
    const selected = workspace.tenants.find((item) => item.id === id);
    persist({ ...workspace, selectedTenantId: id, selectedPersonId: selected?.people[0]?.id ?? null });
    setPeopleQuery("");
    setShowPassword(false);
  }

  function openDialog(kind, item = null) {
    setForm(item ? { ...item } : { ...(kind === "Tenant" ? blankTenant : blankPerson) });
    setShowPassword(false);
    setNotice("");
    setCurlText("");
    setBatchResult(null);
    setPersonSource("manual");
    setPersonPlan(null);
    setPersonFileName("");
    setPersonImportError("");
    setTenantPlan(null);
    setTenantFileName("");
    setTenantImportError("");
    setTenantResult(null);
    setCopiedList(false);
    setBatchTenantIds(kind === "BatchPerson" ? workspace.tenants.map((tenant) => tenant.id) : []);
    setDialog(`${item ? "edit" : "add"}${kind}`);
  }

  function importFromCurl() {
    try {
      const parsed = parseCurlCommand(curlText);
      setForm({ ...form, ...parsed });
      setNotice("");
      setDialog("addTenant");
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function saveTenant(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setNotice("");
    try {
      let next = { ...form, people: form.people || [] };
      if (!String(next.corporationId || "").trim()) {
        const authorized = await authorizeTenant(next);
        next = { ...next, corporationId: authorized.corporationId };
        setForm({ ...form, corporationId: authorized.corporationId });
      }
      const updated = normalizeTenant({ ...next, id: next.id || crypto.randomUUID(), people: next.people || [] });
      const tenants = dialog === "editTenant"
        ? workspace.tenants.map((item) => item.id === updated.id ? updated : item)
        : [...workspace.tenants, updated];
      const selectedPersonId = dialog === "editTenant" && updated.people.some((item) => item.id === workspace.selectedPersonId)
        ? workspace.selectedPersonId
        : updated.people[0]?.id ?? null;
      persist({ ...workspace, tenants, selectedTenantId: updated.id, selectedPersonId });
      setTenantQuery("");
      setDialog(null);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function savePerson(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setNotice("");
    try {
      if (dialog === "addBatchPerson") {
        if (!workspace?.tenants?.length) throw new Error("请先新增租户");
        const selectedIds = new Set(batchTenantIds);
        const targets = workspace.tenants.filter((item) => selectedIds.has(item.id));
        if (!targets.length) throw new Error("请至少选择一个租户");
        const granted = await requestOriginPermissions(targets.map((item) => item.baseUrl));
        if (!granted) throw new Error("未授予域名访问权限，已取消保存");
        const session = createTenantAuthorizer();
        const resolve = (target, person) => resolveStaff(target, person, { authorize: session.authorize });
        const { tenants: resolvedTenants, results } = await savePeopleToTenants(targets, [form], { resolve });
        const succeeded = results.filter((item) => item.ok)
          .map((item) => ({ tenantId: item.tenantId, tenantName: item.tenantName }));
        const failed = results.filter((item) => !item.ok)
          .map((item) => ({ tenantId: item.tenantId, tenantName: item.tenantName, error: item.error }));
        if (succeeded.length) {
          const peopleByTenant = new Map(resolvedTenants.map((item) => [item.id, item.people]));
          const personIdByTenant = new Map(results.filter((item) => item.ok).map((item) => [item.tenantId, item.personId]));
          const tenants = workspace.tenants.map((item) => peopleByTenant.has(item.id) ? { ...item, people: peopleByTenant.get(item.id) } : item);
          const selectedTenantId = personIdByTenant.has(workspace.selectedTenantId)
            ? workspace.selectedTenantId
            : results.find((item) => item.ok).tenantId;
          persist({
            ...workspace,
            tenants,
            selectedTenantId,
            selectedPersonId: personIdByTenant.get(selectedTenantId),
          });
        }
        setBatchResult({ succeeded, failed });
        setNotice("");
        setDialog("globalPersonResult");
        return;
      }
      let next = { ...form };
      if (!String(next.name || "").trim()) {
        const resolved = await resolveStaff(tenant, next);
        next = {
          ...next,
          name: resolved.name,
          staffId: String(next.staffId || "").trim() || resolved.staffId,
          code: String(next.code || "").trim() || resolved.code,
          phone: String(next.phone || "").trim() || resolved.phone,
          email: String(next.email || "").trim() || resolved.email,
        };
        setForm(next);
      }
      const person = normalizePerson({ ...next, id: next.id || crypto.randomUUID() });
      const others = dialog === "editPerson" ? tenant.people.filter((item) => item.id !== person.id) : tenant.people;
      const upserted = upsertPerson(others, person);
      persist({
        ...workspace,
        tenants: workspace.tenants.map((item) => item.id === tenant.id ? { ...tenant, people: upserted.people } : item),
        selectedPersonId: dialog === "addPerson" || workspace.selectedPersonId === person.id
          ? upserted.person.id
          : workspace.selectedPersonId,
      });
      setPeopleQuery("");
      setDialog(null);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  function downloadTenantTemplate() {
    downloadBytes("小合易联-租户导入模板.xlsx", buildWorkbook({ sheets: tenantTemplateSheets() }));
  }

  function downloadPersonTemplate() {
    downloadBytes("小合易联-人员导入模板.xlsx", buildWorkbook({ sheets: personTemplateSheets() }));
  }

  function openTenantImport() {
    setTenantPlan(null);
    setTenantFileName("");
    setTenantImportError("");
    setTenantResult(null);
    setCopiedList(false);
    setDialog("tenantImport");
  }

  function openPersonImport() {
    openDialog("BatchPerson");
    setPersonSource("file");
  }

  async function readImportRows(file, preferred) {
    if (file.size > IMPORT_FILE_LIMIT) throw new Error("文件不能超过 5 MB");
    const sheets = readSheets(new Uint8Array(await file.arrayBuffer()));
    return pickSheet(sheets, preferred).rows;
  }

  async function handleTenantFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setTenantImportError("");
    setTenantResult(null);
    setTenantFileName(file.name);
    try {
      const rows = await readImportRows(file, ["租户"]);
      setTenantPlan(planTenantImport(rows, { existing: workspace.tenants, defaultOrigin: SAAS_DEFAULT_ORIGIN }));
    } catch (error) {
      setTenantPlan(null);
      setTenantImportError(error.message);
    }
  }

  async function handlePersonFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPersonImportError("");
    setPersonFileName(file.name);
    try {
      const rows = await readImportRows(file, ["人员"]);
      setPersonPlan(planPersonImport(rows));
    } catch (error) {
      setPersonPlan(null);
      setPersonImportError(error.message);
    }
  }

  async function executeTenantRows(runnable) {
    setTenantImportBusy(true);
    setTenantImportError("");
    importAbort.current = false;
    setTenantImportProgress({ done: 0, total: runnable.length });
    try {
      const granted = await requestOriginPermissions(runnable.map((item) => item.baseUrl));
      if (!granted) {
        setTenantImportError("未授予域名访问权限，导入已取消");
        return null;
      }
      const executed = [];
      for (const item of runnable) {
        if (importAbort.current) break;
        try {
          const authorized = await authorizeTenant({
            name: item.name, corporationId: "", baseUrl: item.baseUrl, deployment: item.deployment,
            appKey: item.appKey, appSecurity: item.appSecurity, people: [],
          });
          executed.push({ item, corporationId: authorized.corporationId });
        } catch (error) {
          executed.push({ item, error: error?.message || String(error) });
        }
        setTenantImportProgress({ done: executed.length, total: runnable.length });
      }
      return { executed, aborted: importAbort.current };
    } finally {
      setTenantImportBusy(false);
      setTenantImportProgress(null);
      importAbort.current = false;
    }
  }

  function applyTenantExecuted(executed, aborted) {
    const merged = mergeTenantImport(workspace, executed, { makeId: () => crypto.randomUUID() });
    if (merged.changed) {
      persist({
        ...workspace,
        tenants: merged.tenants,
        selectedTenantId: merged.selectedTenantId,
        selectedPersonId: merged.selectedPersonId,
      });
      setTenantQuery("");
    }
    setTenantResult((previous) => {
      const retried = new Set(executed.map((entry) => entry.item.rowNumber));
      return {
        added: [...(previous?.added || []), ...merged.added],
        updated: [...(previous?.updated || []), ...merged.updated],
        failed: [...(previous?.failed || []).filter((item) => !retried.has(item.rowNumber)), ...merged.failed],
        invalid: previous?.invalid || (tenantPlan
          ? tenantPlan.items.filter((item) => item.status === "error" || item.status === "skip")
            .map((item) => ({ rowNumber: item.rowNumber, name: item.name, error: item.error }))
          : []),
        retryItems: executed.filter((entry) => entry.error).map((entry) => entry.item),
        aborted,
      };
    });
  }

  async function runTenantImport() {
    if (!tenantPlan || tenantImportBusy) return;
    const runnable = tenantPlan.items.filter((item) => item.status === "create" || item.status === "update");
    if (!runnable.length) {
      setTenantImportError("没有可导入的行，请检查预览中的错误");
      return;
    }
    try {
      const outcome = await executeTenantRows(runnable);
      if (!outcome) return;
      applyTenantExecuted(outcome.executed, outcome.aborted);
      setDialog("tenantImportResult");
    } catch (error) {
      setTenantImportError(error?.message || String(error));
    }
  }

  async function retryTenantImport() {
    if (!tenantResult?.retryItems?.length || tenantImportBusy) return;
    try {
      const outcome = await executeTenantRows(tenantResult.retryItems);
      if (!outcome) return;
      applyTenantExecuted(outcome.executed, outcome.aborted);
    } catch (error) {
      setTenantImportError(error?.message || String(error));
    }
  }

  async function runPersonImport() {
    if (!personPlan || personImportBusy) return;
    const runnable = personPlan.items.filter((item) => item.status === "ok" || item.status === "warn");
    const selectedIds = new Set(batchTenantIds);
    const targets = workspace.tenants.filter((item) => selectedIds.has(item.id));
    if (!runnable.length) {
      setPersonImportError("没有可导入的人员，请检查预览中的错误");
      return;
    }
    if (!targets.length) {
      setPersonImportError("请至少选择一个租户");
      return;
    }
    setPersonImportBusy(true);
    setPersonImportError("");
    importAbort.current = false;
    setPersonImportProgress({ done: 0, total: runnable.length });
    try {
      const granted = await requestOriginPermissions(targets.map((item) => item.baseUrl));
      if (!granted) {
        setPersonImportError("未授予域名访问权限，导入已取消");
        return;
      }
      const session = createTenantAuthorizer();
      const resolve = (target, person) => resolveStaff(target, person, { authorize: session.authorize });
      const signal = { get aborted() { return importAbort.current; } };
      const outcome = await savePeopleToTenants(targets, runnable.map((item) => item.form), {
        resolve,
        alwaysResolve: true,
        signal,
        onProgress: ({ index, total }) => setPersonImportProgress({ done: Math.min(index + 1, total), total }),
      });
      const peopleByTenant = new Map(outcome.tenants.map((item) => [item.id, item.people]));
      persist({
        ...workspace,
        tenants: workspace.tenants.map((item) => peopleByTenant.has(item.id) ? { ...item, people: peopleByTenant.get(item.id) } : item),
      });
      setBatchResult({
        results: outcome.results,
        aborted: outcome.aborted,
        rowNumbers: runnable.map((item) => item.rowNumber),
        invalid: personPlan.items
          .filter((item) => item.status === "error" || item.status === "skip")
          .map((item) => ({ rowNumber: item.rowNumber, error: item.error })),
      });
      setDialog("globalPersonResult");
    } catch (error) {
      setPersonImportError(error?.message || String(error));
    } finally {
      setPersonImportBusy(false);
      setPersonImportProgress(null);
      importAbort.current = false;
    }
  }

  function cancelImport() {
    importAbort.current = true;
  }

  function copyFailures(text) {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => setCopiedList(true),
      () => setCopiedList(false),
    );
  }

  function remove() {
    if (dialog === "deleteTenant") {
      const tenants = workspace.tenants.filter((item) => item.id !== tenant.id);
      persist({
        ...workspace,
        tenants,
        selectedTenantId: tenants[0]?.id ?? null,
        selectedPersonId: tenants[0]?.people[0]?.id ?? null,
      });
    } else if (personToDelete) {
      const people = tenant.people.filter((item) => item.id !== personToDelete.id);
      persist({
        ...workspace,
        tenants: workspace.tenants.map((item) => item.id === tenant.id ? { ...tenant, people } : item),
        selectedPersonId: workspace.selectedPersonId === personToDelete.id ? people[0]?.id ?? null : workspace.selectedPersonId,
      });
    }
    setDialog(null);
  }

  function askDeletePerson(person) {
    setForm({ ...person });
    setNotice("");
    setDialog("deletePerson");
  }

  function exportBackup() {
    const blob = new Blob([createBackup(workspace)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `小合易联-备份-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDialog(null);
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("备份文件不能超过 5 MB");
      setPendingImport(parseBackup(await file.text()));
      setDialog("import");
      setNotice("");
    } catch (error) {
      setNotice(`导入失败：${error.message}`);
    }
  }

  function confirmImport() {
    persist(pendingImport);
    setTenantQuery("");
    setPeopleQuery("");
    setPendingImport(null);
    setDialog(null);
  }

  if (!workspace) return <main className="loading">正在读取本地资料…</main>;
  return <div className="settings-shell">
    <aside className="settings-sidebar">
      <header className="brand"><img src="/icons/icon-48.png" alt="" /><strong>小合·易联</strong></header>
      <section className="tenant-navigation" aria-label="租户管理">
        <div className="sidebar-title-row">
          <h2>租户管理</h2>
          <div className="sidebar-title-actions">
            <button className="add-tenant-action" onClick={() => openDialog("Tenant")}><Plus size={17} />新增租户</button>
            <button className="add-tenant-action" disabled={!workspace.tenants.length} title={workspace.tenants.length ? "选择一个或多个租户批量新增人员" : "请先新增租户"} onClick={() => openDialog("BatchPerson")}><Plus size={17} />批量新增人员</button>
          </div>
        </div>
        <label className="tenant-search"><Search size={19} aria-hidden="true" /><input value={tenantQuery} onChange={(event) => setTenantQuery(event.target.value)} placeholder="搜索租户名称或企业 ID" aria-label="搜索租户" /></label>
        <nav className="tenant-list" aria-label="租户列表">
          {visibleTenants.map((item) => <button className={`tenant-option ${tenant?.id === item.id ? "active" : ""}`} key={item.id} onClick={() => selectTenant(item.id)}><span>{item.name}</span><small>{item.deployment === "saas" ? "SaaS" : "本地化"}</small></button>)}
          {visibleTenants.length === 0 && <div className="tenant-empty">{normalizedTenantQuery ? "没有匹配的租户" : "尚未添加租户"}</div>}
        </nav>
      </section>
      <div className="sidebar-bottom"><button className="sidebar-bottom-action" onClick={() => setDialog("backup")}><FileUp size={19} />导入 / 导出</button></div>
    </aside>
    <main className="settings-main">
      {notice && !dialog && <div className="notice" role="alert">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice("")}><X size={16} /></button></div>}
      {tenant ? <>
        <header className="tenant-titlebar">
          <div className="tenant-title"><h1>{tenant.name}</h1><span>{tenant.deployment === "saas" ? "SaaS" : "本地化"}</span></div>
          <div className="tenant-actions">
            <button className="secondary-button compact" onClick={() => openDialog("Tenant", tenant)}><Pencil size={17} />编辑租户</button>
            <button className="danger-button compact" onClick={() => setDialog("deleteTenant")}><Trash2 size={17} />删除租户</button>
          </div>
        </header>
        <section className="tenant-details" aria-label="租户资料">
          <DetailField label="企业 ID">{tenant.corporationId}</DetailField>
          <DetailField label="部署方式">{tenant.deployment === "saas" ? "SaaS" : "本地化"}</DetailField>
          <DetailField label="API 基础地址">{tenant.baseUrl}</DetailField>
          <DetailField label="接入账号" className="wide-field">{tenant.appKey}</DetailField>
          <DetailField label="接入密码" className="wide-field"><span className="password-value">{showPassword ? tenant.appSecurity : "••••••••••••"}</span><button className="icon-button" type="button" title={showPassword ? "隐藏密码" : "显示密码"} aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></DetailField>
        </section>
        <section className="people-section" aria-label="人员管理">
          <h2>人员管理</h2>
          <PeopleView tenant={tenant} selectedPersonId={workspace.selectedPersonId} query={peopleQuery} onQueryChange={setPeopleQuery} onAdd={() => openDialog("Person")} onImport={openPersonImport} onEdit={(person) => openDialog("Person", person)} onDelete={askDeletePerson} />
        </section>
      </> : <section className="workspace-empty"><div><h1>开始维护租户资料</h1><p>新增租户后，可继续维护该租户下的人员档案。</p><button className="primary-button" onClick={() => openDialog("Tenant")}><Plus size={19} />新增租户</button></div></section>}
    </main>
    <input ref={fileInput} className="visually-hidden" type="file" accept=".json,application/json" onChange={importBackup} />
    <input ref={tenantFileInput} className="visually-hidden" type="file" accept=".xlsx" onChange={handleTenantFile} />
    <input ref={personFileInput} className="visually-hidden" type="file" accept=".xlsx" onChange={handlePersonFile} />

    {(dialog === "addTenant" || dialog === "editTenant") && <Modal title={dialog === "addTenant" ? "新增租户" : "编辑租户"} error={notice} onClose={() => setDialog(null)} footer={<><button className="secondary-button" onClick={() => setDialog(null)}>取消</button>{dialog === "editTenant" && <button className="danger-button" onClick={() => setDialog("deleteTenant")}><Trash2 size={16} />删除租户</button>}<button className="primary-button" type="submit" form="tenant-form" disabled={saving}>{saving ? "处理中…" : "保存"}</button></>}>
      <form id="tenant-form" onSubmit={saveTenant} className="edit-form">
        {dialog === "addTenant" && <div className="curl-import-entry">
          <button type="button" className="outline-button compact" onClick={() => { setNotice(""); setDialog("curlImport"); }}><FileUp size={17} />从 cURL 导入</button>
          <button type="button" className="outline-button compact" onClick={openTenantImport}><FileUp size={17} />从 Excel 批量导入</button>
        </div>}
        <Field label="租户名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        <Field label="企业 ID" value={form.corporationId} onChange={(event) => setForm({ ...form, corporationId: event.target.value })} placeholder="留空后自动获取" />
        <label className="field"><span>部署方式</span><select value={form.deployment} onChange={(event) => setForm({ ...form, deployment: event.target.value, baseUrl: event.target.value === "saas" ? SAAS_DEFAULT_ORIGIN : form.baseUrl })}><option value="saas">SaaS</option><option value="onPrem">本地化</option></select></label>
        <Field label="访问地址（HTTPS 域名）" type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} required />
        <Field label="接入账号（appKey）" value={form.appKey} onChange={(event) => setForm({ ...form, appKey: event.target.value })} required autoComplete="off" />
        <label className="field"><span>接入密码（appSecurity）</span><div className="password-wrap"><input type={showPassword ? "text" : "password"} value={form.appSecurity} onChange={(event) => setForm({ ...form, appSecurity: event.target.value })} required autoComplete="new-password" /><button type="button" className="icon-button" title={showPassword ? "隐藏密码" : "显示密码"} aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
        <p className="form-note">企业 ID 可留空，保存时会通过接入凭证自动获取；接入密码会以明文保存在当前浏览器的扩展本地资料中。</p>
      </form>
    </Modal>}

    {dialog === "curlImport" && <Modal title="从 cURL 导入" error={notice} onClose={() => setDialog("addTenant")} footer={<><button className="secondary-button" type="button" onClick={() => setDialog("addTenant")}>返回</button><button className="primary-button" type="button" onClick={importFromCurl}>解析并填充</button></>}>
      <div className="curl-import-body">
        <p className="form-note">粘贴包含 --url 和 --data 的 getAccessToken cURL 命令。扩展会提取访问地址（HTTPS 域名）、appKey 和 appSecurity，不会保存 Cookie 或请求头。</p>
        <textarea className="curl-import-textarea" value={curlText} onChange={(event) => setCurlText(event.target.value)} placeholder={`curl --request POST \\\n  --url https://<your-api-host>/api/openapi/v1/auth/getAccessToken \\\n  --data '{"appKey":"...","appSecurity":"..."}'`} autoFocus spellCheck={false} aria-label="cURL 命令" />
      </div>
    </Modal>}

    {(dialog === "addPerson" || dialog === "editPerson" || dialog === "addBatchPerson") && <Modal
      title={dialog === "addBatchPerson" ? "批量新增人员" : dialog === "addPerson" ? "新增人员" : "编辑人员"}
      wide={dialog === "addBatchPerson"}
      error={personImportError || notice}
      onClose={() => { if (!personImportBusy) setDialog(null); }}
      footer={<>
        <button className="secondary-button" onClick={() => setDialog(null)} disabled={personImportBusy}>取消</button>
        {dialog === "addBatchPerson" && personImportBusy && <button className="secondary-button" type="button" onClick={cancelImport}>中止</button>}
        {dialog === "editPerson" && <button className="danger-button" onClick={() => setDialog("deletePerson")}><Trash2 size={16} />删除人员</button>}
        {dialog === "addBatchPerson" && personSource === "file"
          ? <button className="primary-button" type="button" onClick={runPersonImport} disabled={personImportBusy || !personPlan}>{personImportBusy ? `导入中 ${personImportProgress?.done ?? 0}/${personImportProgress?.total ?? 0}` : "导入"}</button>
          : <button className="primary-button" type="submit" form="person-form" disabled={saving || (dialog === "addBatchPerson" && !batchTenantIds.length)}>{saving ? "处理中…" : "保存"}</button>}
      </>}>
      <form id="person-form" className="edit-form" onSubmit={dialog === "addBatchPerson" && personSource === "file" ? (event) => event.preventDefault() : savePerson}>
        {dialog === "addBatchPerson" ? <>
          <div className="field"><span>租户</span><BatchTenantPicker tenants={workspace.tenants} value={batchTenantIds} onChange={setBatchTenantIds} /></div>
          <div className="import-source-tabs" role="tablist" aria-label="人员来源">
            <button type="button" role="tab" aria-selected={personSource === "manual"} className={`import-source-tab${personSource === "manual" ? " active" : ""}`} onClick={() => setPersonSource("manual")}>手动填写</button>
            <button type="button" role="tab" aria-selected={personSource === "file"} className={`import-source-tab${personSource === "file" ? " active" : ""}`} onClick={() => setPersonSource("file")}>从 Excel 导入</button>
          </div>
          {personSource === "file"
            ? <div className="import-panel">
              <div className="import-file-row">
                <button type="button" className="outline-button compact" onClick={downloadPersonTemplate}><Download size={17} />下载导入模板</button>
                <button type="button" className="outline-button compact" onClick={() => personFileInput.current?.click()}><FileUp size={17} />选择 Excel 文件</button>
                {personFileName && <span className="import-file-name" title={personFileName}>{personFileName}</span>}
              </div>
              <p className="form-note">表格列为姓名、人员 ID、工号、手机号、邮箱。第 2 行示例数据会自动跳过；无论是否填写姓名，导入都会用所选租户的凭据逐个查询人员 ID，查不到或与表格填写不一致的行会失败。一次最多 {PERSON_IMPORT_LIMIT} 行。</p>
              {personPlan && <PersonImportPreview plan={personPlan} selectedTenantCount={batchTenantIds.length} busy={personImportBusy} progress={personImportProgress} />}
            </div>
            : <>
              <PersonFields form={form} onChange={setForm} />
              <p className="form-note">{`保存时会尝试为已选择的 ${batchTenantIds.length} 个租户新增人员。姓名为空时，会分别使用各租户的凭证匹配员工；匹配失败的租户会自动跳过，保存后显示成功和未匹配名单。`}</p>
            </>}
        </> : <>
          <Field label="租户" value={tenant?.name || ""} readOnly />
          <PersonFields form={form} onChange={setForm} />
          <p className="form-note">至少填写人员 ID、工号、手机号或邮箱之一。姓名为空时，保存会根据员工信息自动回填；无人员 ID 时优先按工号查询。</p>
        </>}
      </form>
    </Modal>}

    {dialog === "tenantImport" && <Modal title="从 Excel 导入租户" wide error={tenantImportError} onClose={() => { if (!tenantImportBusy) setDialog("addTenant"); }} footer={<>
      <button className="secondary-button" type="button" onClick={() => setDialog("addTenant")} disabled={tenantImportBusy}>返回</button>
      {tenantImportBusy && <button className="secondary-button" type="button" onClick={cancelImport}>中止</button>}
      <button className="primary-button" type="button" onClick={runTenantImport} disabled={tenantImportBusy || !tenantPlan}>{tenantImportBusy ? `导入中 ${tenantImportProgress?.done ?? 0}/${tenantImportProgress?.total ?? 0}` : "开始导入"}</button>
    </>}>
      <div className="import-panel">
        <div className="import-file-row">
          <button type="button" className="outline-button compact" onClick={downloadTenantTemplate}><Download size={17} />下载导入模板</button>
          <button type="button" className="outline-button compact" onClick={() => tenantFileInput.current?.click()}><FileUp size={17} />选择 Excel 文件</button>
          {tenantFileName && <span className="import-file-name" title={tenantFileName}>{tenantFileName}</span>}
        </div>
        <p className="form-note">表格列为租户名称、域名、appKey、appSecurity；第 2 行示例数据会自动跳过，域名留空时使用内置 SaaS 地址。导入时会逐个调用授权接口获取企业 ID，一次最多 {TENANT_IMPORT_LIMIT} 行。</p>
        {tenantPlan && <TenantImportPreview plan={tenantPlan} busy={tenantImportBusy} progress={tenantImportProgress} />}
      </div>
    </Modal>}

    {dialog === "tenantImportResult" && tenantResult && <Modal title="导入租户结果" onClose={() => { if (!tenantImportBusy) setDialog("addTenant"); }} footer={<>
      {tenantResult.retryItems?.length ? <button className="secondary-button" type="button" onClick={retryTenantImport} disabled={tenantImportBusy}>{tenantImportBusy ? "重试中…" : `授权并重试（${tenantResult.retryItems.length} 行）`}</button> : null}
      <button className="secondary-button" type="button" onClick={() => copyFailures(failureText([...tenantResult.failed, ...tenantResult.invalid]))} disabled={!tenantResult.failed.length && !tenantResult.invalid.length}>{copiedList ? "已复制" : "复制未导入清单"}</button>
      <button className="primary-button" type="button" onClick={() => setDialog("addTenant")} disabled={tenantImportBusy}>完成</button>
    </>}>
      {tenantImportError && <p className="modal-error" role="alert">{tenantImportError}</p>}
      <div className="global-result-summary">
        <p>新增 <strong>{tenantResult.added.length}</strong> 个租户，更新 <strong>{tenantResult.updated.length}</strong> 个，未导入 <strong>{tenantResult.failed.length + tenantResult.invalid.length}</strong> 行{tenantResult.aborted ? "（已中止，已完成部分已保存）" : ""}。</p>
        <section className="global-result-section">
          <h3>新增租户（{tenantResult.added.length}）</h3>
          {tenantResult.added.length
            ? <ul className="global-result-list">{tenantResult.added.map((item) => <li key={item.id}>第 {item.rowNumber} 行 · {item.name}</li>)}</ul>
            : <p className="form-note">无</p>}
        </section>
        <section className="global-result-section">
          <h3>更新租户（{tenantResult.updated.length}）</h3>
          {tenantResult.updated.length
            ? <ul className="global-result-list">{tenantResult.updated.map((item) => <li key={item.id}>第 {item.rowNumber} 行 · {item.name}</li>)}</ul>
            : <p className="form-note">无</p>}
        </section>
        <section className="global-result-section global-result-failed">
          <h3>未导入（{tenantResult.failed.length + tenantResult.invalid.length}）</h3>
          {tenantResult.failed.length + tenantResult.invalid.length
            ? <ul className="global-result-list">{[...tenantResult.failed, ...tenantResult.invalid].map((item) => <li key={`${item.rowNumber}-${item.error}`}><strong>第 {item.rowNumber} 行 {item.name || ""}</strong><span>{item.error}</span></li>)}</ul>
            : <p className="form-note">无</p>}
        </section>
      </div>
    </Modal>}

    {dialog === "globalPersonResult" && batchResult && <Modal
      title={batchResult.results ? "导入人员结果" : "批量新增结果"}
      onClose={() => { setBatchResult(null); setDialog(null); }}
      footer={<>
        {batchResult.results ? <button className="secondary-button" type="button" onClick={() => copyFailures(personFailureText)} disabled={!personFailureText}>{copiedList ? "已复制" : "复制失败清单"}</button> : <button className="secondary-button" onClick={() => { setBatchResult(null); setDialog(null); }}>关闭</button>}
        {batchResult.results && <button className="primary-button" type="button" onClick={() => { setBatchResult(null); setDialog(null); }}>完成</button>}
      </>}>
      {batchResult.results
        ? <PersonResultBody result={batchResult} />
        : <div className="global-result-summary">
          <p>成功 <strong>{batchResult.succeeded.length}</strong> 个租户，未匹配 <strong>{batchResult.failed.length}</strong> 个租户。</p>
          <section className="global-result-section">
            <h3>成功租户（{batchResult.succeeded.length}）</h3>
            {batchResult.succeeded.length
              ? <ul className="global-result-list">{batchResult.succeeded.map((item) => <li key={item.tenantId}>{item.tenantName}</li>)}</ul>
              : <p className="form-note">无</p>}
          </section>
          <section className="global-result-section global-result-failed">
            <h3>未匹配租户（{batchResult.failed.length}）</h3>
            {batchResult.failed.length
              ? <ul className="global-result-list">{batchResult.failed.map((item) => <li key={item.tenantId}><strong>{item.tenantName}</strong><span>{item.error}</span></li>)}</ul>
              : <p className="form-note">无</p>}
          </section>
        </div>}
    </Modal>}

    {(dialog === "deleteTenant" || dialog === "deletePerson") && <Modal title={dialog === "deleteTenant" ? "删除租户" : "删除人员"} onClose={() => setDialog(null)} footer={<><button className="secondary-button" onClick={() => setDialog(null)}>取消</button><button className="danger-button solid" onClick={remove}>确认删除</button></>}><p>将删除{dialog === "deleteTenant" ? `租户“${tenant.name}”及其全部人员` : `人员“${personToDelete?.name}”`}，此操作无法撤销。</p></Modal>}

    {dialog === "backup" && <Modal title="导入 / 导出" onClose={() => setDialog(null)} footer={<button className="secondary-button" onClick={() => setDialog(null)}>关闭</button>}>
      <div className="backup-actions">
        <div><h3>导出完整资料</h3><p>备份包含所有租户、人员以及<strong>明文接入密码</strong>。请妥善保存，不要通过公开渠道传输。</p><button className="outline-button" onClick={() => setDialog("export")}><Download size={17} />导出 JSON</button></div>
        <div><h3>从备份导入</h3><p>选择此前导出的 JSON 文件。校验后预览数量，确认后整体替换当前资料。</p><button className="outline-button" onClick={() => { setDialog(null); fileInput.current?.click(); }}><FileUp size={17} />选择 JSON</button></div>
      </div>
    </Modal>}

    {dialog === "export" && <Modal title="确认导出明文备份" onClose={() => setDialog("backup")} footer={<><button className="secondary-button" onClick={() => setDialog("backup")}>取消</button><button className="primary-button" onClick={exportBackup}>我已了解，导出</button></>}><p>文件包含 {workspace.tenants.length} 个租户的接入账号和<strong>明文密码</strong>。备份不包含授权 token 或生成过的访问链接。</p></Modal>}

    {dialog === "import" && pendingImport && <Modal title="确认替换本地资料" onClose={() => { setPendingImport(null); setDialog(null); }} footer={<><button className="secondary-button" onClick={() => { setPendingImport(null); setDialog(null); }}>取消</button><button className="danger-button solid" onClick={confirmImport}>整体替换</button></>}><p>备份中有 <strong>{pendingImport.tenants.length} 个租户</strong>、<strong>{pendingImport.tenants.reduce((count, item) => count + item.people.length, 0)} 个人员</strong>。确认后将替换当前 {workspace.tenants.length} 个租户及其资料，无法自动撤销。</p></Modal>}
  </div>;
}