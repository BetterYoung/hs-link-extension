import { useState } from "react";
import { X } from "lucide-react";
import { TAG_NAME_LIMIT, TAG_PALETTE, TENANT_TAG_RECOMMENDED, tagUsage } from "./tags.js";

/** 标签胶囊：颜色只做辅助，文字始终可见，避免只靠颜色传达信息。 */
export function TagChip({ tag, small, onRemove }) {
  return <span className={`tag-chip${small ? " tag-chip-small" : ""}`} style={{ "--tag-color": tag.color }} title={tag.name}>
    <span className="tag-chip-label">{tag.name}</span>
    {onRemove && <button type="button" className="tag-chip-remove" aria-label={`移除标签 ${tag.name}`} title="移除标签" onClick={(event) => { event.stopPropagation(); onRemove(); }}><X size={11} /></button>}
  </span>;
}

/**
 * 标签列表：超出 max 时折叠成「+N」，悬停显示完整清单。
 * 列表类界面用它控制行高，详情类界面直接传 max 让全部显示。
 */
export function TagList({ tags, max, small }) {
  if (!tags || tags.length === 0) return null;
  const visible = max ? tags.slice(0, max) : tags;
  const rest = tags.length - visible.length;
  return <>
    {visible.map((tag) => <TagChip key={tag.id} tag={tag} small={small} />)}
    {rest > 0 && <span className="tag-chip tag-chip-small tag-chip-more" title={tags.slice(visible.length).map((tag) => tag.name).join("、")}>+{rest}</span>}
  </>;
}

function ColorRow({ value, onChange, label = "标签颜色" }) {
  return <span className="tag-color-row" role="group" aria-label={label}>
    {TAG_PALETTE.map((item) => <button
      type="button"
      key={item}
      className={`tag-color${item === value ? " active" : ""}`}
      style={{ background: item }}
      aria-label={`使用颜色 ${item}`}
      aria-pressed={item === value}
      title={`颜色 ${item}`}
      onClick={() => onChange(item)}
    />)}
  </span>;
}

/** 租户表单里的标签选择器：点选已有标签（不设硬上限，建议 2 个以内），可内联新建。 */
export function TagPicker({ tags, value = [], onChange, onCreate, onManage }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_PALETTE[0]);
  const [error, setError] = useState("");
  const selected = value.map((id) => tags.find((tag) => tag.id === id)).filter(Boolean);
  const overRecommended = selected.length > TENANT_TAG_RECOMMENDED;

  function toggle(id) {
    setError("");
    if (value.includes(id)) onChange(value.filter((item) => item !== id));
    else onChange([...value, id]);
  }

  function submit() {
    try {
      const tag = onCreate(name, color);
      onChange([...value, tag.id]);
      setName("");
      setCreating(false);
      setError("");
    } catch (caught) {
      setError(caught.message);
    }
  }

  return <div className="tag-picker">
    <div className="tag-picker-selected">
      {selected.map((tag) => <TagChip key={tag.id} tag={tag} onRemove={() => toggle(tag.id)} />)}
      {selected.length === 0 && <span className="tag-picker-hint">未设置标签</span>}
      {overRecommended && <span className="tag-picker-hint">已选 {selected.length} 个，建议 2 个以内更易读</span>}
    </div>
    <div className="tag-picker-options">
      {tags.filter((tag) => !value.includes(tag.id)).map((tag) => <button
        type="button"
        key={tag.id}
        className="tag-option"
        onClick={() => toggle(tag.id)}
      ><span className="tag-option-dot" style={{ background: tag.color }} />{tag.name}</button>)}
      {tags.length === 0 && <span className="tag-picker-hint">还没有标签，先新建一个</span>}
    </div>
    {error && <p className="tag-picker-error" role="alert">{error}</p>}
    {creating
      // 这里不能用 <form>：它嵌在租户表单里，submit 会冒泡上去直接保存租户。
      ? <div className="tag-create-form">
        <input
          value={name}
          maxLength={TAG_NAME_LIMIT}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            event.stopPropagation();
            submit();
          }}
          placeholder="新标签名称，如 中影生产"
          aria-label="新标签名称"
          autoFocus
        />
        <ColorRow value={color} onChange={setColor} />
        <button className="primary-button compact" type="button" onClick={submit}>创建</button>
        <button className="secondary-button compact" type="button" onClick={() => { setCreating(false); setError(""); setName(""); }}>取消</button>
      </div>
      : <div className="tag-picker-actions">
        <button type="button" className="outline-button compact" onClick={() => setCreating(true)}>+ 新建标签</button>
        <button type="button" className="link-button" onClick={onManage}>管理标签</button>
      </div>}
  </div>;
}

/** 标签库管理弹窗的主体：新建、改名、改色、删除（删除前二次确认）。 */
export function TagManagerBody({ tags, tenants, onCreate, onRename, onRecolor, onDelete }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_PALETTE[0]);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState(null);

  function create(event) {
    event.preventDefault();
    try {
      onCreate(name, color);
      setName("");
      setError("");
    } catch (caught) {
      setError(caught.message);
    }
  }

  function rename(tag, next) {
    if (next.trim() === tag.name) return;
    try {
      onRename(tag.id, next);
      setError("");
    } catch (caught) {
      setError(caught.message);
    }
  }

  function recolor(tag, next) {
    try {
      onRecolor(tag.id, next);
      setError("");
    } catch (caught) {
      setError(caught.message);
    }
  }

  return <div className="tag-manager">
    <form className="tag-create-form" onSubmit={create}>
      <input value={name} maxLength={TAG_NAME_LIMIT} onChange={(event) => setName(event.target.value)} placeholder="新标签名称" aria-label="新标签名称" />
      <ColorRow value={color} onChange={setColor} />
      <button className="primary-button compact" type="submit">新建标签</button>
    </form>
    {error && <p className="modal-error" role="alert">{error}</p>}
    <p className="form-note">共 {tags.length} 个标签；建议每个租户配置 2 个以内，便于列表阅读。改名或改色会立即同步到所有已使用该标签的租户。</p>
    <ul className="tag-manager-list">
      {tags.map((tag) => {
        const used = tagUsage(tenants, tag.id);
        return <li className="tag-manager-row" key={tag.id}>
          <ColorRow value={tag.color} onChange={(next) => recolor(tag, next)} label={`标签 ${tag.name} 的颜色`} />
          <input
            className="tag-manager-name"
            defaultValue={tag.name}
            maxLength={TAG_NAME_LIMIT}
            aria-label={`标签名称 ${tag.name}`}
            key={`${tag.id}-${tag.name}`}
            onBlur={(event) => rename(tag, event.target.value)}
          />
          <span className="tag-manager-usage">{used ? `${used} 个租户` : "未使用"}</span>
          {confirmId === tag.id
            ? <>
              <button type="button" className="danger-button compact" onClick={() => { onDelete(tag.id); setConfirmId(null); }}>确认删除</button>
              <button type="button" className="secondary-button compact" onClick={() => setConfirmId(null)}>取消</button>
            </>
            : <button type="button" className="secondary-button compact" onClick={() => setConfirmId(tag.id)}>删除</button>}
        </li>;
      })}
      {tags.length === 0 && <li className="tag-manager-empty">还没有标签，先在上方新建。</li>}
    </ul>
    {confirmId && <p className="form-note tag-manager-warning">删除后会从所有租户上移除该标签，无法撤销。</p>}
  </div>;
}
