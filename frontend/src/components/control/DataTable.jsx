import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import ActionMenu from "../ui/ActionMenu"
import EmptyState from "../ui/EmptyState"
import Pagination from "../ui/Pagination"

/* The one table used by every Control Center screen.

   columns   [{ key, header, render?(row), sortValue?(row), className?, hideBelow? ("md"|"lg") }]
             a column with `sortValue` (or a plain `key` and no render) is click-to-sort
   rows      the data; rowKey(row) -> id
   onRowClick(row)        opens the row's drawer
   actions(row) -> items  compact ⋮ menu (same items as ActionMenu)
   page / pageSize / total / onPageChange   server-side paging (optional) —
                          without them the table sorts everything client-side. */
export default function DataTable({ columns, rows = [], rowKey = (r) => r.id, onRowClick, actions, loading, empty, page, pageSize, total, onPageChange, sortable = true }) {
  const [sort, setSort] = useState(null) // { key, dir }

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    const val = (r) => (col?.sortValue ? col.sortValue(r) : r[sort.key])
    return [...rows].sort((a, b) => {
      const x = val(a)
      const y = val(b)
      const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "en", { numeric: true, sensitivity: "base" })
      return sort.dir === "asc" ? cmp : -cmp
    })
  }, [rows, sort, columns])

  const toggle = (key) => setSort((s) => (s?.key === key ? (s.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" }))
  const hide = (c) => (c.hideBelow === "lg" ? "hidden lg:table-cell" : c.hideBelow === "md" ? "hidden md:table-cell" : "")
  const paged = page != null && total != null

  return (
    <div className="min-w-0">
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60">
              {columns.map((c) => {
                const canSort = sortable && !paged && c.sortable !== false && (c.sortValue || (!c.render && c.key))
                const active = sort?.key === c.key
                return (
                  <th key={c.key} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined} className={`px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted ${hide(c)} ${c.className || ""}`}>
                    {canSort ? (
                      <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 hover:text-ink">
                        {c.header}
                        {active ? (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ChevronsUpDown size={12} className="opacity-50" />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
              {actions && <th scope="col" className="w-10 px-2"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {loading
              ? [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td colSpan={columns.length + (actions ? 1 : 0)} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-surface-2" /></td>
                  </tr>
                ))
              : sorted.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(row) } : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    className={`border-b border-border last:border-0 ${onRowClick ? "cursor-pointer hover:bg-surface-2/60 focus-visible:bg-surface-2/60 focus-visible:outline-none" : ""}`}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={`px-4 py-2.5 align-middle text-ink ${hide(c)} ${c.className || ""}`}>
                        {c.render ? c.render(row) : row[c.key] ?? <span className="text-muted-2">—</span>}
                      </td>
                    ))}
                    {actions && (
                      <td className="px-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <ActionMenu items={actions(row)} />
                      </td>
                    )}
                  </tr>
                ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && <div className="p-4">{empty || <EmptyState title="Nothing to show" description="No records match the current filters." />}</div>}
      </div>
      {paged && <Pagination page={page} pageSize={pageSize} total={total} totalPages={Math.ceil(total / pageSize)} onPageChange={onPageChange} />}
    </div>
  )
}
