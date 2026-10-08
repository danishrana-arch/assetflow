import { Check, Minus } from "lucide-react"

/* Rows × columns grid of yes/no cells (roles × modules, roles × CRUD, …).

   rows     [{ key, label, sub? }]        columns  [{ key, label }]
   allowed(rowKey, colKey) -> boolean
   Read-only by design: role → module access is defined in code
   (backend/src/utils/roles.js), so this shows it faithfully instead of
   offering switches that would not change anything. */
export default function PermissionMatrix({ rows, columns, allowed, caption }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-border bg-surface-2/60">
            <th scope="col" className="sticky left-0 bg-surface-2 px-4 py-2.5"><span className="sr-only">Role</span></th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border last:border-0">
              <th scope="row" className="sticky left-0 whitespace-nowrap bg-surface px-4 py-2.5 text-left font-medium text-ink">
                {r.label}
                {r.sub && <span className="ml-2 text-xs font-normal text-muted">{r.sub}</span>}
              </th>
              {columns.map((c) => {
                const yes = allowed(r.key, c.key)
                return (
                  <td key={c.key} className="px-3 py-2.5 text-center">
                    {yes ? <Check size={16} className="mx-auto text-success" aria-label="Allowed" /> : <Minus size={14} className="mx-auto text-muted-2" aria-label="Not allowed" />}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
