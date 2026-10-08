/* One usage-vs-limit row. state: ok | warn (>= 80%) | full | over.
   No limit -> just the figure ("No cap"). */
const BAR = { ok: "bg-accent", warn: "bg-warning", full: "bg-danger", over: "bg-danger" }
const NOTE = { warn: "Approaching the limit", full: "Limit reached", over: "Over the limit" }

export default function UsageMeter({ metric, compact }) {
  const { label, used, limit, unit, state } = metric
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const figure = `${used}${unit ? ` ${unit}` : ""}${limit != null ? ` / ${limit}${unit ? ` ${unit}` : ""}` : ""}`
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-medium text-ink">{label}</span>
        <span className="shrink-0 tabular-nums text-muted">{limit == null ? `${figure} · No cap` : figure}</span>
      </div>
      {limit != null && (
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)} aria-label={label}>
          <div className={`h-full rounded-full ${BAR[state] || BAR.ok}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {!compact && NOTE[state] && <p className={`mt-1 text-xs font-medium ${state === "warn" ? "text-warning" : "text-danger"}`}>{NOTE[state]}</p>}
    </div>
  )
}
