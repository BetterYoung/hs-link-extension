import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, ExternalLink, Link2, LoaderCircle, Search, Settings } from "lucide-react";
import { applyResolvedPerson, emptyWorkspace, loadWorkspace, saveWorkspace, STORAGE_KEY } from "./model.js";
import { authorizeTenant, generateAccessLink, PermissionRequiredError, requestOriginPermission, resolveStaff } from "./openapi.js";
import {
  findLocalMatches,
  LOOKUP_DIMENSIONS,
  lookupQueryPerson,
  mergeResolvedPerson,
  validateLookupValue,
} from "./lookupPerson.js";

const RULE_LABEL = "Web 首页 · 7 天 · 可重复访问";

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

/** 查询面板维度：姓名只查本地，其余维度支持在线查询。 */
const QUERY_DIMENSIONS = [
  ...LOOKUP_DIMENSIONS,
  { key: "name", label: "姓名", placeholder: "搜索本地姓名" },
];

/**
 * 人员选择器：
 * - 点击人员行打开本地姓名列表；
 * - 点击右侧查询按钮直接进入按维度查询面板（人员 ID / 工号 / 手机号 / 邮箱 / 姓名）。
 *   姓名只搜本地；其余维度本地优先，未命中调接口并直接保存、选中。
 */
function PersonPicker({ people, value, onChange, disabled, onLookup }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("local");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [dimension, setDimension] = useState("staffId");
  const [lookupValue, setLookupValue] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupChoices, setLookupChoices] = useState(null);
  const activeRef = useRef(0);
  const rootRef = useRef(null);
  const lookupInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function setActive(index) {
    activeRef.current = index;
    setActiveIndex(index);
  }

  useEffect(() => { setActive(0); }, [query, open, dimension, lookupValue]);

  function resetPanel() {
    setQuery("");
    setView("local");
    setDimension("staffId");
    setLookupValue("");
    setLookupBusy(false);
    setLookupError("");
    setLookupChoices(null);
  }

  function close() {
    setOpen(false);
    resetPanel();
  }

  function openLocal() {
    if (open && view === "local") { close(); return; }
    resetPanel();
    setView("local");
    setOpen(true);
  }

  function openLookup() {
    if (open && view === "lookup") { close(); return; }
    resetPanel();
    setView("lookup");
    setOpen(true);
    setTimeout(() => lookupInputRef.current?.focus(), 0);
  }

  const selected = (people || []).find((person) => person.id === value) || null;
  const term = query.trim().toLocaleLowerCase();
  const filtered = (people || []).filter((person) => !term || String(person.name || "").toLocaleLowerCase().includes(term));
  const dimensionItem = QUERY_DIMENSIONS.find((item) => item.key === dimension) || QUERY_DIMENSIONS[0];
  const isNameMode = dimension === "name";
  const nameTerm = lookupValue.trim().toLocaleLowerCase();
  const nameMatches = isNameMode
    ? (people || []).filter((person) => !nameTerm || String(person.name || "").toLocaleLowerCase().includes(nameTerm))
    : [];

  function choose(id) {
    onChange(id);
    close();
  }

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
      close();
    }
  }

  async function submitLookup() {
    if (isNameMode) {
      const person = nameMatches[activeRef.current] || nameMatches[0];
      if (person) choose(person.id);
      return;
    }
    if (lookupBusy) return;
    setLookupError("");
    setLookupChoices(null);
    setLookupBusy(true);
    try {
      const outcome = await onLookup({ dimension, value: lookupValue });
      if (outcome?.status === "choose") {
        setLookupChoices(outcome.people);
        return;
      }
      close();
    } catch (error) {
      setLookupError(error?.message || String(error));
    } finally {
      setLookupBusy(false);
    }
  }

  function onLookupKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      submitLookup();
    } else if (isNameMode && event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(nameMatches.length - 1, activeRef.current + 1));
    } else if (isNameMode && event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(0, activeRef.current - 1));
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  return <div className="person-picker" ref={rootRef}>
    <div className="person-picker-row">
      <button type="button" className="person-picker-trigger" disabled={disabled} onClick={openLocal} aria-haspopup="listbox" aria-expanded={open && view === "local"} title={selected ? selected.name : "请选择人员"}>
        <span>{selected ? selected.name : "请选择人员"}</span><ChevronDown size={18} aria-hidden="true" />
      </button>
      <button type="button" className="person-picker-query" disabled={disabled} onClick={openLookup} aria-expanded={open && view === "lookup"} title="按维度查询人员" aria-label="按维度查询人员"><Search size={18} /></button>
    </div>
    {open && <div className="person-picker-panel">
      {view === "local" ? <>
        <input className="person-picker-search" value={query} autoFocus placeholder="搜索姓名" onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} aria-label="搜索人员" />
        <div className="person-picker-list" role="listbox" aria-label="人员列表">
          {filtered.map((person, index) => <button type="button" role="option" aria-selected={person.id === value} className={`person-picker-option${index === activeIndex ? " active" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => choose(person.id)} key={person.id}>{person.name}</button>)}
          {filtered.length === 0 && <p className="person-picker-empty">本地没有匹配的人员</p>}
        </div>
      </> : <div className="person-lookup">
        <div className="person-lookup-dims" role="tablist" aria-label="查询维度">
          {QUERY_DIMENSIONS.map((item) => <button type="button" role="tab" aria-selected={dimension === item.key} className={dimension === item.key ? "active" : ""} onClick={() => { setDimension(item.key); setLookupError(""); setLookupChoices(null); }} key={item.key}>{item.label}</button>)}
        </div>
        <div className={`person-lookup-form${isNameMode ? " name-mode" : ""}`}>
          <input ref={lookupInputRef} className="person-lookup-input" value={lookupValue} placeholder={dimensionItem.placeholder} onChange={(event) => { setLookupValue(event.target.value); setLookupError(""); setLookupChoices(null); }} onKeyDown={onLookupKeyDown} disabled={lookupBusy} aria-label="查询内容" />
          {!isNameMode && <button type="button" className="person-lookup-submit" onClick={submitLookup} disabled={lookupBusy || !lookupValue.trim()}>{lookupBusy ? "查询中…" : "查询"}</button>}
        </div>
        {isNameMode ? <div className="person-picker-list" role="listbox" aria-label="本地人员列表">
          {nameMatches.map((person, index) => <button type="button" role="option" aria-selected={person.id === value} className={`person-picker-option${index === activeIndex ? " active" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => choose(person.id)} key={person.id}>{person.name}</button>)}
          {nameMatches.length === 0 && <p className="person-picker-empty">本地没有匹配的人员</p>}
        </div> : <>
          {lookupError
            ? <p className="person-lookup-message error" role="alert">{lookupError}</p>
            : <p className="person-lookup-message">本地优先；未命中会在线查询并直接保存到本地人员。</p>}
          {lookupChoices && <div className="person-picker-list">
            {lookupChoices.map((person) => <button type="button" className="person-picker-option" onClick={() => choose(person.id)} key={person.id}>{person.name}<small>{person.code || person.phone || "本地记录"}</small></button>)}
          </div>}
        </>}
      </div>}
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
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    loadWorkspace().then((saved) => { if (active) setWorkspace(saved); }).catch((error) => {
      if (!active) return;
      setNotice(error.message);
      setWorkspace(emptyWorkspace());
    });
    const onChanged = (changes, area) => {
      if (area !== "local" || !changes?.[STORAGE_KEY]) return;
      loadWorkspace().then((saved) => { if (active) setWorkspace(saved); }).catch(() => {});
    };
    globalThis.chrome?.storage?.onChanged?.addListener(onChanged);
    return () => {
      active = false;
      globalThis.chrome?.storage?.onChanged?.removeListener(onChanged);
    };
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
      return true;
    } catch (error) {
      setNotice(`保存失败：${error.message}`);
      return false;
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

  /** 本地优先的人员查询：命中本地直接选中；未命中调接口，查到后保存并选中。 */
  async function lookupPerson({ dimension, value }) {
    if (!tenant) throw new Error("请先选择租户");
    const clean = validateLookupValue(dimension, value);
    // 写前重读，避免设置页刚保存的人员被旧快照覆盖。
    const latest = await loadWorkspace().catch(() => workspace);
    const target = latest.tenants.find((item) => item.id === tenant.id);
    if (!target) throw new Error("该租户已被删除，请重新选择租户");
    const matches = findLocalMatches(target.people, { dimension, value: clean });
    if (matches.length > 1) return { status: "choose", people: matches };
    if (matches.length === 1) {
      const next = { ...latest, selectedTenantId: target.id, selectedPersonId: matches[0].id };
      reset();
      await persist(next);
      setNotice(`已从本地记录选中：${matches[0].name}`);
      return { status: "selected" };
    }
    if (!isExtension) throw new Error("网页预览不能连接 OpenAPI，请在扩展弹窗中使用。");
    await requestOriginPermission(target.baseUrl);
    const resolved = await resolveStaff(target, lookupQueryPerson(dimension, clean), {
      authorize: authorizeTenant,
      noConditionError: "请填写人员 ID、工号、手机号或邮箱之一",
    });
    const merged = mergeResolvedPerson(target.people, resolved, { makeId: () => crypto.randomUUID() });
    const nextWorkspace = {
      ...latest,
      tenants: latest.tenants.map((item) => item.id === target.id ? { ...target, people: merged.people } : item),
      selectedTenantId: target.id,
      selectedPersonId: merged.person.id,
    };
    reset();
    const saved = await persist(nextWorkspace);
    if (!saved) throw new Error("已查询到人员，但保存到本地失败，请重试");
    const label = LOOKUP_DIMENSIONS.find((item) => item.key === dimension)?.label || "查询";
    setNotice(merged.created
      ? `已查询并保存到本地人员：${merged.person.name}（${label} ${clean}）`
      : `已刷新本地人员记录：${merged.person.name}（${label} ${clean}）`);
    return { status: "selected" };
  }

  if (!workspace) return <main className="popup-loading">正在读取本地资料…</main>;
  const canGenerate = Boolean(tenant && person && !busy);
  return <main className="popup-shell">
    <header className="popup-header">
      <div className="popup-brand"><img className="popup-logo" src="./icons/icon-48.png" alt="" /><div><h1>小合·易联</h1><p>{RULE_LABEL}</p></div></div>
      <div className="popup-header-actions">
        <button className="popup-settings" type="button" title="打开租户和人员管理" aria-label="打开租户和人员管理" onClick={openSettings}><Settings size={23} /></button>
      </div>
    </header>

    <section className="popup-fields" aria-label="快捷生成设置">
      <div className="popup-row"><span>租户</span><TenantPicker tenants={workspace.tenants} value={tenant?.id || ""} onChange={selectTenant} disabled={!workspace.tenants.length} /></div>
      <div className="popup-row"><span>人员</span><PersonPicker people={tenant?.people || []} value={person?.id || ""} onChange={selectPerson} onLookup={lookupPerson} disabled={!tenant} /></div>
      <div className="popup-row"><span>链接</span><div className="popup-link" title={result?.url || "生成后显示访问链接"}><span>{result?.url || "生成后显示访问链接"}</span><button type="button" disabled={!result} title="复制链接" aria-label="复制链接" onClick={copyLink}>{copied ? <Check size={19} /> : <Copy size={19} />}</button></div></div>
    </section>

    {notice && <p className="popup-notice" role="alert">{notice}</p>}
    {!workspace.tenants.length && <button className="popup-empty-action" type="button" onClick={openSettings}>请先到设置页添加租户和人员</button>}

    <div className="popup-actions">
      <button className="popup-button popup-primary" type="button" disabled={!canGenerate} onClick={generateOrGrant}>{busy ? <LoaderCircle className="popup-spin" size={18} /> : <Link2 size={18} />}{busy || (permissionOrigin ? "授权继续" : "生成链接")}</button>
      <button className="popup-button popup-secondary" type="button" disabled={!result} onClick={copyLink}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? "已复制" : "复制链接"}</button>
      <button className="popup-button popup-secondary popup-open" type="button" disabled={!result} onClick={openLink}><ExternalLink size={18} />打开链接</button>
    </div>
  </main>;
}
