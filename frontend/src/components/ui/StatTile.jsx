import { Link } from "react-router-dom"

/* A clickable headline number (the tiles above a list).

   label, value, hint   the figure; hint is a small line under it
   icon                 plain black/white icon, no chip or colour (lucide or StatusIcons)
   active               ring + aria-pressed when the tile is the current filter
   onClick | to         button or link - the whole tile is the target
   expanded             optional; set on tiles that open a panel (aria-expanded)
   tone                 neutral | green | blue | amber - soft tinted surface only
   className            extra classes (grid placement, etc.)

   Used by Employees; usable anywhere a number should also be a filter. */
const TONES = {
  neutral: "bg-surface-2 border-border",
  green: "bg-chip-green-bg/40 border-chip-green-bg dark:bg-chip-green-tint/[0.06] dark:border-chip-green-tint/10",
  blue: "bg-chip-blue-bg/35 border-chip-blue-bg/80 dark:bg-chip-blue-tint/[0.06] dark:border-chip-blue-tint/10",
  amber: "bg-chip-yellow-bg/40 border-chip-yellow-bg dark:bg-chip-yellow-tint/[0.06] dark:border-chip-yellow-tint/10",
}

export default function StatTile({ label, value, hint, icon: Icon, active = false, onClick, to, expanded, tone = "neutral", className = "" }) {
  const cls = `block w-full rounded-2xl border p-4 text-left transition-all hover:-translate-y-px hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    TONES[tone] || TONES.neutral
  } ${active ? "ring-2 ring-accent" : ""} ${className}`
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted">{label}</p>
        {Icon && <Icon size={20} className="shrink-0 text-ink" aria-hidden="true" />}
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
    </>
  )
  if (to) return <Link to={to} className={cls}>{body}</Link>
  return (
    <button type="button" onClick={onClick} aria-pressed={expanded == null ? active : undefined} aria-expanded={expanded} className={cls}>
      {body}
    </button>
  )
}
