import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2 } from "lucide-react";

const maskPhone = (phone) => phone?.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone || "—";
const PAGE_SIZE = 10;

export function PeopleView({ tenant, selectedPersonId, query, onQueryChange, onAdd, onEdit, onDelete }) {
  const [page, setPage] = useState(1);
  const people = tenant?.people ?? [];
  const term = query.trim().toLocaleLowerCase();
  const visible = people.filter((person) => [person.name, person.staffId, person.code, person.phone, person.email || ""]
    .some((value) => value.toLocaleLowerCase().includes(term)));
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagePeople = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    if (!selectedPersonId || term) {
      setPage(1);
      return;
    }
    const selectedIndex = visible.findIndex((person) => person.id === selectedPersonId);
    setPage(selectedIndex >= 0 ? Math.floor(selectedIndex / PAGE_SIZE) + 1 : 1);
  }, [tenant?.id, selectedPersonId]);

  function changeQuery(value) {
    setPage(1);
    onQueryChange(value);
  }

  return <div className="people-management-panel">
    <div className="people-toolbar">
      <label className="people-search"><Search size={19} aria-hidden="true" /><input value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="搜索姓名、人员 ID、工号、手机号或邮箱" aria-label="搜索人员" /></label>
      <div className="people-toolbar-actions"><span>共 {people.length} 人</span><button className="primary-button compact" onClick={onAdd}><Plus size={18} />新增人员</button></div>
    </div>
    <div className="people-table" role="table" aria-label={`${tenant.name}的人员`}>
      <div className="people-table-head" role="row"><span role="columnheader">姓名</span><span role="columnheader">人员 ID</span><span role="columnheader">工号</span><span role="columnheader">手机号</span><span role="columnheader">邮箱</span><span role="columnheader">操作</span></div>
      <div className="people-table-body">
        {pagePeople.map((person) => <div className="people-table-row" role="row" key={person.id}>
          <span className="person-name" role="cell"><small>姓名</small>{person.name}</span>
          <span role="cell"><small>人员 ID</small>{person.staffId || "—"}</span>
          <span role="cell"><small>工号</small>{person.code || "—"}</span>
          <span role="cell"><small>手机号</small>{maskPhone(person.phone)}</span>
          <span className="person-email" role="cell"><small>邮箱</small>{person.email || "—"}</span>
          <span className="row-actions" role="cell"><button className="icon-button" title={`编辑${person.name}`} aria-label={`编辑${person.name}`} onClick={() => onEdit(person)}><Pencil size={18} /></button><button className="icon-button danger-icon" title={`删除${person.name}`} aria-label={`删除${person.name}`} onClick={() => onDelete(person)}><Trash2 size={18} /></button></span>
        </div>)}
        {visible.length === 0 && <div className="management-empty"><p>{term ? "没有匹配的人员" : "当前租户还没有人员"}</p>{!term && <button className="outline-button compact" onClick={onAdd}><Plus size={18} />新增人员</button>}</div>}
      </div>
    </div>
    <nav className="people-pagination" aria-label="人员列表分页">
      <span>{term ? `找到 ${visible.length} 人` : `每页 ${PAGE_SIZE} 人`}</span>
      <div>
        <button className="icon-button" type="button" title="上一页" aria-label="上一页" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={18} /></button>
        <span>第 {currentPage} / {pageCount} 页</span>
        <button className="icon-button" type="button" title="下一页" aria-label="下一页" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight size={18} /></button>
      </div>
    </nav>
  </div>;
}