import { useState } from "react"
import { ChevronDown } from "lucide-react"

/* A KPI that opens into its own details without leaving the page.

   label, value, hint     the headline figure
   icon, tone             optional; tone = blue|green|amber|red (left dot)
   children               detail content (real data only); no children ->
                          a plain, non-interactive card
   Click / Enter toggles. For a group of 3-4 headline metrics on a dashboard
   use InteractiveMetricWorkspace instead; this is the single-card version
   for tables, drawers and pages. */
const DOT = { blue: "bg-info", green: "bg-success", amber: "bg-warning", red: "bg-danger" }

export default function MetricCard({ label, value, hint, icon: Icon, tone, children, defaultOpen = false, className = "" }) {
  const [open, setOpen] = useState(defaultOpen)
  const expandable = children != null && children !== false
  const head = (
    <>
      <div className="flex items-center gap-2">
        {tone && <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone] || "bg-muted"}`} aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted">{label}</span>
        {Icon && <Icon size={16} className="shrink-0 text-ink" />}
        {expandable && <ChevronDown size={14} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />}
      </div>
      <p className="mt-2 text-2xl font-semibold leading-none tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  )
  return (
    <div className={`min-w-0 rounded-2xl border border-border bg-surface ${className}`}>
      {expandable ? (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="block w-full rounded-2xl p-3.5 text-left hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {head}
        </button>
      ) : (
        <div className="p-3.5">{head}</div>
      )}
      {expandable && open && <div className="border-t border-border px-3.5 py-3 text-sm">{children}</div>}
    </div>
  )
}
