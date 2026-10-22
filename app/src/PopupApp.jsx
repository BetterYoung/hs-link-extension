import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, ExternalLink, Link2, LoaderCircle, Settings } from "lucide-react";
import { applyResolvedPerson, emptyWorkspace, loadWorkspace, normalizePerson, saveWorkspace } from "./model.js";
import { authorizeTenant, generateAccessLink, PermissionRequiredError, requestOriginPermission, resolveStaff } from "./openapi.js";

const RULE_LABEL = "Web 首页 · 7 天 · 可重复访问";
const blankBatchPerson = { name: "", staffId: "", code: "", phone: "", email: "" };

/** 租户选择器：支持按名称搜索的下拉单选。 */
function TenantPicker({ tenants, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const selected = tenants.find((tenant) => tenant.id === value) || null;
  const term = query.trim().toLocaleLowerCase();
  const filtered = tenants.filter((tenant) => tenant.name.toLocaleLowerCase().includes(term));
  const choose = (id) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return <div className="tenant-picker" ref={rootRef}>
    <button type="button" className="tenant-picker-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} title={selected ? selected.name : "请选择租户"} onClick={() => { setOpen(!open); setQuery(""); }}>
      <span>{selected ? selected.name : "请选择租户"}</span><span className="tenant-picker-arrow" aria-hidden="true">{open ? "▴" : "▾"}</span>
    </button>
    {open && <div className="tenant-picker-panel">
      <input className="tenant-picker-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索租户名称" aria-label="搜索租户名称" autoFocus />
      <div className="tenant-picker-list" role="listbox" aria-label="租户列表">
        {filtered.map((tenant) => <button type="button" role="option" aria-selected={tenant.id === value} className={`tenant-picker-option${tenant.id === value ? " active" : ""}`} onClick={() => choose(tenant.id)} key={tenant.id}><span>{tenant.name}</span><small>{tenant.deployment === "saas" ? "SaaS" : "本地化"}</small></button>)}
        {filtered.length === 0 && <p className="tenant-picker-empty">没有匹配的租户</p>}
      </div>
    </div>}
  </div>;
}

/** 人员选择器：支持按姓名搜索、方向键移动与回车选择。 */
function PersonPicker({ people, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRef = useRef(0);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function setActive(index) {
    activeRef.current = index;
    setActiveIndex(index);
  }

  useEffect(() => { setActive(0); }, [query, open]);

  const selected = (people || []).find((person) => person.id === value) || null;
  const term = query.trim().toLocaleLowerCase();
  const filtered = (people || []).filter((person) => !term || String(person.name || "").toLocaleLowerCase().includes(term));
  const choose = (id) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  function onKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(filtered.length - 1, activeRef.current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(0, activeRef.current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const person = filtered[activeRef.current];
      if (person) choose(person.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  return <div className="person-picker" ref={rootRef}>
    <button type="button" className="person-picker-trigger" disabled={disabled} onClick={() => { setOpen(!open); setQuery(""); }} aria-haspopup="listbox" aria-expanded={open} title={selected ? selected.name : "请选择人员"}>
      <span>{selected ? selected.name : "请选择人员"}</span><ChevronDown size={18} aria-hidden="true" />
    </button>
    {open && <div className="person-picker-panel">
      <input className="person-picker-search" value={query} autoFocus placeholder="搜索姓名" onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} aria-label="搜索人员" />
      <div className="person-picker-list" role="listbox" aria-label="人员列表">
        {filtered.map((person, index) => <button type="button" role="option" aria-selected={person.id === value} className={`person-picker-option${index === activeIndex ? " active" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => choose(person.id)} key={person.id}>{person.name}</button>)}
        {filtered.length === 0 && <p className="person-picker-empty">没有匹配的人员</p>}
      </div>
    </div>}
  </div>;
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

  return <div className="popup-batch-tenant-picker" ref={rootRef}>
    <button type="button" className="popup-batch-tenant-trigger" aria-expanded={open} aria-haspopup="group" onClick={() => setOpen(!open)}>
      <span>{label}</span><span className="popup-batch-tenant-arrow" aria-hidden="true">{open ? "▴" : "▾"}</span>
    </button>
    {open && <div className="popup-batch-tenant-panel" role="group" aria-label="选择租户">
      <input className="popup-batch-tenant-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索租户名称" aria-label="搜索租户名称" autoFocus />
      <label className="popup-batch-tenant-option popup-batch-tenant-all">
        <input type="checkbox" checked={filteredSelected} onChange={(event) => {
          const ids = new Set(filtered.map((tenant) => tenant.id));
          onChange(event.target.checked ? [...new Set([...value, ...ids])] : value.filter((id) => !ids.has(id)));
        }} />
        <span>全选当前结果</span>
      </label>
      {filtered.map((tenant) => <label className="popup-batch-tenant-option" key={tenant.id}>
        <input type="checkbox" checked={selected.has(tenant.id)} onChange={(event) => onChange(event.target.checked ? [...value, tenant.id] : value.filter((id) => id !== tenant.id))} />
        <span>{tenant.name}</span><small>{tenant.deployment === "saas" ? "SaaS" : "本地化"}</small>
      </label>)}
      {filtered.length === 0 && <p className="popup-batch-tenant-empty">没有匹配的租户</p>}
    </div>}
  </div>;
}

export function PopupApp() {
  const isExtension = Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome?.storage?.local && globalThis.chrome?.permissions);
  const [workspace, setWorkspace] = useState(null);
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);
  const [permissionOrigin, setPermissionOrigin] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchView, setBatchView] = useState("form");
  const [batchTenantIds, setBatchTenantIds] = useState([]);
  const [batchForm, setBatchForm] = useState(blankBatchPerson);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState("");
  const [batchResult, setBatchResult] = useState(null);
  const generation = useRef(0);

  useEffect(() => {
    loadWorkspace().then(setWorkspace).catch((error) => {
      setNotice(error.message);
      setWorkspace(emptyWorkspace());
    });
  }, []);

  const tenant = workspace?.tenants.find((item) => item.id === workspace.selectedTenantId);
  const person = tenant?.people.find((item) => item.id === workspace.selectedPersonId);

  function reset() {
    generation.current += 1;
    setResult(null);
    setCopied(false);
    setPermissionOrigin("");
    setBusy("");
  }

  async function persist(next) {
    setWorkspace(next);
    setNotice("");
    try {
      await saveWorkspace(next);
    } catch (error) {
      setNotice(`保存失败：${error.message}`);
    }
  }

  function selectTenant(id) {
    const selected = workspace.tenants.find((item) => item.id === id);
    reset();
    persist({ ...workspace, selectedTenantId: id, selectedPersonId: selected?.people[0]?.id ?? null });
  }

  function selectPerson(id) {
    reset();
    persist({ ...workspace, selectedPersonId: id });
  }

  async function generate({ skipConfiguredPermission = false } = {}) {
    if (!tenant || !person || busy) return;
    if (!isExtension) {
      setNotice("网页预览不能连接 OpenAPI，请在扩展弹窗中使用。");
      return;
    }
    const current = ++generation.current;
    setResult(null);
    setCopied(false);
    setNotice("");
    setBusy("检查权限");
    try {
      if (!skipConfiguredPermission) await requestOriginPermission(tenant.baseUrl);
      if (current !== generation.current) return;
      const link = await generateAccessLink(tenant, person, {
        onStep: (step) => { if (current === generation.current) setBusy(step); },
      });
      if (current !== generation.current) return;
      setResult(link);
      setPermissionOrigin("");
      if (link.resolvedPerson) {
        const next = applyResolvedPerson(workspace, tenant.id, person.id, link.resolvedPerson);
        await persist(next);
      }
    } catch (error) {
      if (current !== generation.current) return;
      if (error instanceof PermissionRequiredError) {
        setPermissionOrigin(error.origin);
        setNotice(`需要授权访问 ${new URL(error.origin).host}`);
      } else {
        setNotice(error.message);
      }
    } finally {
      if (current === generation.current) setBusy("");
    }
  }

  async function generateOrGrant() {
    if (!permissionOrigin) {
      await generate();
      return;
    }
    try {
      await requestOriginPermission(permissionOrigin);
      setPermissionOrigin("");
      await generate({ skipConfiguredPermission: true });
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setNotice("");
    } catch {
      setNotice("复制失败，请打开链接后从地址栏复制");
    }
  }

  function openLink() {
    if (!result) return;
    if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url: result.url });
    else window.open(result.url, "_blank", "noopener,noreferrer");
  }

  async function openSettings() {
    if (globalThis.chrome?.runtime?.openOptionsPage) {
      await chrome.runtime.openOptionsPage();
      window.close();
    } else {
      window.location.assign("./index.html");
    }
  }

  function openBatch() {
    if (!workspace?.tenants.length) return;
    setBatchView("form");
    setBatchTenantIds(workspace.tenants.map((item) => item.id));
    setBatchForm({ ...blankBatchPerson });
    setBatchBusy(false);
    setBatchError("");
    setBatchResult(null);
    setBatchOpen(true);
  }

  function closeBatch() {
    if (batchBusy) return;
    setBatchOpen(false);
    setBatchError("");
    setBatchResult(null);
  }

  function updateBatchForm(field, value) {
    setBatchForm((current) => ({ ...current, [field]: value }));
  }

  async function saveBatchPerson(event) {
    event.preventDefault();
    if (batchBusy) return;
    const targets = workspace.tenants.filter((item) => batchTenantIds.includes(item.id));
    if (!targets.length) {
      setBatchError("请至少选择一个租户");
      return;
    }
    setBatchBusy(true);
    setBatchError("");
    const sharedId = crypto.randomUUID();
    const peopleByTenant = new Map();
    const succeeded = [];
    const failed = [];
    for (const target of targets) {
      try {
        let person = { ...batchForm };
        if (!String(person.name || "").trim()) {
          const resolved = await resolveStaff(target, person, {
            authorize: authorizeTenant,
            noConditionError: "请填写人员 ID、工号、手机号或邮箱之一",
          });
          person = {
            ...person,
            name: resolved.name,
            staffId: String(person.staffId || "").trim() || resolved.staffId,
            code: String(person.code || "").trim() || resolved.code,
            phone: String(person.phone || "").trim() || resolved.phone,
            email: String(person.email || "").trim() || resolved.email,
          };
        }
        peopleByTenant.set(target.id, normalizePerson({ ...person, id: sharedId }));
        succeeded.push({ tenantId: target.id, tenantName: target.name });
      } catch (error) {
        failed.push({ tenantId: target.id, tenantName: target.name, error: error?.message || String(error) });
      }
    }
    if (succeeded.length) {
      try {
        const tenants = workspace.tenants.map((item) => peopleByTenant.has(item.id)
          ? { ...item, people: [...item.people, peopleByTenant.get(item.id)] }
          : item);
        const selectedTenantId = peopleByTenant.has(workspace.selectedTenantId)
          ? workspace.selectedTenantId
          : workspace.tenants.find((item) => peopleByTenant.has(item.id))?.id ?? workspace.selectedTenantId;
        const saved = await saveWorkspace({ ...workspace, tenants, selectedTenantId, selectedPersonId: sharedId });
        setWorkspace(saved);
        reset();
      } catch (error) {
        setBatchError(`保存失败：${error.message}`);
        setBatchBusy(false);
        return;
      }
    }
    setBatchResult({ succeeded, failed });
    setBatchView("result");
    setBatchBusy(false);
  }

  if (!workspace) return <main className="popup-loading">正在读取本地资料…</main>;
  const canGenerate = Boolean(tenant && person && !busy);
  return <main className={`popup-shell${batchOpen ? " popup-shell-batch" : ""}`}>
    <header className="popup-header">
      <div className="popup-brand"><img className="popup-logo" src="./icons/icon-48.png" alt="" /><div><h1>小合·易联</h1><p>{RULE_LABEL}</p></div></div>
      <div className="popup-header-actions">
        <button className="popup-batch-add" type="button" disabled={!isExtension || !workspace.tenants.length} title="批量新增人员" onClick={openBatch}><span className="popup-batch-plus" aria-hidden="true">＋</span>批量新增</button>
        <button className="popup-settings" type="button" title="打开租户和人员管理" aria-label="打开租户和人员管理" onClick={openSettings}><Settings size={23} /></button>
      </div>
    </header>

    <section className="popup-fields" aria-label="快捷生成设置">
      <div className="popup-row"><span>租户</span><TenantPicker tenants={workspace.tenants} value={tenant?.id || ""} onChange={selectTenant} disabled={!workspace.tenants.length} /></div>
      <div className="popup-row"><span>人员</span><PersonPicker people={tenant?.people || []} value={person?.id || ""} onChange={selectPerson} disabled={!tenant} /></div>
      <div className="popup-row"><span>链接</span><div className="popup-link" title={result?.url || "生成后显示访问链接"}><span>{result?.url || "生成后显示访问链接"}</span><button type="button" disabled={!result} title="复制链接" aria-label="复制链接" onClick={copyLink}>{copied ? <Check size={19} /> : <Copy size={19} />}</button></div></div>
    </section>

    {notice && <p className="popup-notice" role="alert">{notice}</p>}
    {!workspace.tenants.length && <button className="popup-empty-action" type="button" onClick={openSettings}>请先到设置页添加租户和人员</button>}

    <div className="popup-actions">
      <button className="popup-button popup-primary" type="button" disabled={!canGenerate} onClick={generateOrGrant}>{busy ? <LoaderCircle className="popup-spin" size={18} /> : <Link2 size={18} />}{busy || (permissionOrigin ? "授权继续" : "生成链接")}</button>
      <button className="popup-button popup-secondary" type="button" disabled={!result} onClick={copyLink}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? "已复制" : "复制链接"}</button>
      <button className="popup-button popup-secondary popup-open" type="button" disabled={!result} onClick={openLink}><ExternalLink size={18} />打开链接</button>
    </div>

    {batchOpen && <div className="popup-batch-backdrop">
      <section className="popup-batch-modal" role="dialog" aria-modal="true" aria-label="批量新增人员">
        <header className="popup-batch-header">
          <h2>{batchView === "result" ? "批量新增结果" : "批量新增人员"}</h2>
          <button className="popup-batch-close" type="button" disabled={batchBusy} title="关闭" aria-label="关闭" onClick={closeBatch}>×</button>
        </header>
        <div className="popup-batch-body">
          {batchError && <p className="popup-batch-error" role="alert">{batchError}</p>}
          {batchView === "form" ? <form id="popup-batch-form" className="popup-batch-form" onSubmit={saveBatchPerson}>
            <div className="popup-batch-field"><span>租户</span><BatchTenantPicker tenants={workspace.tenants} value={batchTenantIds} onChange={setBatchTenantIds} /></div>
            <label className="popup-batch-field"><span>姓名</span><input value={batchForm.name} onChange={(event) => updateBatchForm("name", event.target.value)} placeholder="留空后从员工信息自动回填" autoComplete="off" /></label>
            <label className="popup-batch-field"><span>人员 ID</span><input value={batchForm.staffId} onChange={(event) => updateBatchForm("staffId", event.target.value)} autoComplete="off" /></label>
            <label className="popup-batch-field"><span>工号（Code）</span><input value={batchForm.code} onChange={(event) => updateBatchForm("code", event.target.value)} autoComplete="off" /></label>
            <label className="popup-batch-field"><span>手机号</span><input type="tel" value={batchForm.phone} onChange={(event) => updateBatchForm("phone", event.target.value)} autoComplete="off" /></label>
            <label className="popup-batch-field"><span>邮箱</span><input type="email" value={batchForm.email} onChange={(event) => updateBatchForm("email", event.target.value)} autoComplete="off" /></label>
            <p className="popup-batch-note">已选择 {batchTenantIds.length} 个租户。至少填写人员 ID、工号、手机号或邮箱之一；姓名为空时会分别使用各租户凭证匹配员工，失败租户将跳过。</p>
          </form> : batchResult && <div className="popup-batch-result">
            <p className="popup-batch-summary">成功 <strong>{batchResult.succeeded.length}</strong> 个租户，未匹配 <strong>{batchResult.failed.length}</strong> 个租户。</p>
            <section className="popup-batch-result-section">
              <h3>成功租户（{batchResult.succeeded.length}）</h3>
              {batchResult.succeeded.length ? <ul>{batchResult.succeeded.map((item) => <li key={item.tenantId}>{item.tenantName}</li>)}</ul> : <p>无</p>}
            </section>
            <section className="popup-batch-result-section popup-batch-result-failed">
              <h3>未匹配租户（{batchResult.failed.length}）</h3>
              {batchResult.failed.length ? <ul>{batchResult.failed.map((item) => <li key={item.tenantId}><strong>{item.tenantName}</strong><span>{item.error}</span></li>)}</ul> : <p>无</p>}
            </section>
          </div>}
        </div>
        <footer className="popup-batch-footer">
          {batchView === "form"
            ? <><button className="popup-batch-cancel" type="button" disabled={batchBusy} onClick={closeBatch}>取消</button><button className="popup-batch-submit" type="submit" form="popup-batch-form" disabled={batchBusy || !batchTenantIds.length}>{batchBusy ? "处理中…" : "保存"}</button></>
            : <button className="popup-batch-submit" type="button" onClick={closeBatch}>关闭</button>}
        </footer>
      </section>
    </div>}
  </main>;
}