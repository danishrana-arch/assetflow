import { actionLabel, fmtDateTime } from "./shared"

const show = (v) => {
  if (v === null || v === undefined) return "—"
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none"
  if (typeof v === "object") return JSON.stringify(v)
  if (typeof v === "boolean") return v ? "Yes" : "No"
  return String(v)
}

// Flattens one level of nested objects: { FIRST: { canRead: true } } -> "FIRST · canRead".
function flatten(obj, prefix = "") {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v, `${prefix}${k} · `))
    else out[`${prefix}${k}`] = v
  }
  return out
}

// Before → after values for one audit entry (`details` = { before, after, reason… }).
export function ChangeDiff({ details }) {
  if (!details) return <p className="text-xs text-muted">No structured before/after values were recorded for this entry.</p>
  const before = flatten(details.before)
  const after = flatten(details.after)
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  const reason = details.reason || details.note
  return (
    <div className="space-y-2">
      {keys.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-surface-2/60 text-[10px] uppercase tracking-wide text-muted">
                <th className="px-3 py-1.5">Field</th>
                <th className="px-3 py-1.5">Before</th>
                <th className="px-3 py-1.5">After</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const changed = show(before[k]) !== show(after[k])
                return (
                  <tr key={k} className="border-t border-border">
                    <td className="px-3 py-1.5 font-medium text-ink">{k}</td>
                    <td className="px-3 py-1.5 text-muted [overflow-wrap:anywhere]">{show(before[k])}</td>
                    <td className={`px-3 py-1.5 [overflow-wrap:anywhere] ${changed ? "font-semibold text-ink" : "text-muted"}`}>{show(after[k])}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {reason && <p className="text-xs text-muted"><span className="font-semibold text-ink">Reason:</span> {reason}</p>}
      {details.paymentCollected === false && <p className="text-xs text-muted">Manual assignment — no payment was collected.</p>}
    </div>
  )
}

// A compact, expandable list of audit entries (used by the organization drawer).
export function AuditEntryList({ entries, showOrganization }) {
  if (!entries?.length) return <p className="py-6 text-center text-sm text-muted">No activity recorded yet.</p>
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
      {entries.map((e) => (
        <li key={e.id}>
          <details className="group px-4 py-3">
            <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-sm font-semibold capitalize text-ink">{actionLabel(e.action)}</span>
              <span className="text-xs text-muted">{e.actor?.name || "System"}{showOrganization && e.organization ? ` · ${e.organization.name}` : ""}</span>
              <span className="ml-auto text-xs text-muted">{fmtDateTime(e.createdAt)}</span>
              {e.note && <span className="basis-full text-xs text-muted">{e.note}</span>}
            </summary>
            <div className="mt-2"><ChangeDiff details={e.details} /></div>
          </details>
        </li>
      ))}
    </ul>
  )
}
