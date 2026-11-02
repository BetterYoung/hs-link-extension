/** 导入预览表：只负责渲染，状态与错误由调用方整理成 cells。 */
export function ImportPreview({ headers, rows, label = "导入预览" }) {
  return <div className="import-preview" role="table" aria-label={label}>
    <div className="import-preview-head" role="row">
      {headers.map((header) => <span role="columnheader" key={header}>{header}</span>)}
    </div>
    <div className="import-preview-body">
      {rows.map((row) => <div className={`import-preview-row${row.tone ? ` tone-${row.tone}` : ""}`} role="row" key={row.key}>
        {row.cells.map((value, index) => <span role="cell" key={index} title={typeof value === "string" ? value : undefined}>{value}</span>)}
      </div>)}
    </div>
  </div>;
}
