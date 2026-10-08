import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, LayoutGrid } from "lucide-react"

/* Reusable click-to-expand metric workspace.

   metrics: [{
     id, title, value, icon, tone ("blue"|"green"|"amber"|"red"),
     description,                       // what the value means
     stats: [{ label, value }],         // related figures (already real data)
     items: [{ id, primary, secondary, badge, to }],  // optional people/rows list
     emptyText,
     action: { label, to }              // the one intentional way out, never auto-followed
   }]
   wide: desktop/tablet layout; false -> stacked (phones).
   loading: dims the numbers while data refreshes.

   Overview: all metrics side by side. Click one (mouse, touch, Enter/Space) and
   the same area re-flows: the other metrics rise into a compact strip along the
   top and the chosen one's detail panel slides in from the right edge. Click a
   compact one to switch, "Overview" or Esc to go back. Every box is positioned
   from one piece of state, so the change is a single CSS transition. */

const TONES = {
  blue: { dot: "bg-info", bar: "bg-info" },
  green: { dot: "bg-success", bar: "bg-success" },
  amber: { dot: "bg-warning", bar: "bg-warning" },
  red: { dot: "bg-danger", bar: "bg-danger" },
}

const GAP = "12px"
const STRIP_H = "56px"
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)"
const MOVE = `left 420ms ${EASE}, top 420ms ${EASE}, width 420ms ${EASE}, height 420ms ${EASE}`

// Overview: equal columns. Open: the other metrics rise into a strip along the
// top and the chosen one fills the space below (its panel slides in from the
// right edge, see .metric-slide-right).
function boxStyle(index, count, activeIndex) {
  if (activeIndex < 0) {
    return {
      left: `calc(${index} * (100% + ${GAP}) / ${count})`,
      top: 0,
      width: `calc((100% + ${GAP}) / ${count} - ${GAP})`,
      height: "100%",
      transition: MOVE,
    }
  }
  if (index === activeIndex) {
    return { left: 0, top: `calc(${STRIP_H} + ${GAP})`, width: "100%", height: `calc(100% - ${STRIP_H} - ${GAP})`, transition: "none" }
  }
  const slot = index < activeIndex ? index : index - 1
  const others = count - 1
  return {
    left: `calc(${slot} * (100% + ${GAP}) / ${others})`,
    top: 0,
    width: `calc((100% + ${GAP}) / ${others} - ${GAP})`,
    height: STRIP_H,
    transition: MOVE,
  }
}

const cardBase =
  "min-w-0 rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"

function Dot({ tone }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${TONES[tone]?.dot || "bg-muted"}`} aria-hidden="true" />
}

// Overview card: icon + label on top, number at the bottom.
function RestingCard({ m, onActivate, loading }) {
  const Icon = m.icon
  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label={`${m.title}: ${m.value}. Show details`}
      className={`flex h-full w-full flex-col p-4 text-left transition-colors hover:bg-surface-2/60 ${cardBase}`}
    >
      <div className="flex items-center gap-2">
        <Dot tone={m.tone} />
        <span className="truncate text-sm font-medium text-muted">{m.title}</span>
      </div>
      <Icon size={28} className="mt-3 text-ink" />
      <span className={`mt-auto pt-2 text-3xl font-semibold leading-none text-ink transition-opacity sm:text-4xl ${loading ? "opacity-50" : ""}`}>
        {m.value}
      </span>
    </button>
  )
}

// Compact selectable row shown while another metric is open.
function CompactCard({ m, onActivate }) {
  const Icon = m.icon
  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label={`${m.title}: ${m.value}. Show details`}
      className={`flex h-full w-full items-center gap-2.5 px-3.5 text-left transition-colors hover:bg-surface-2/60 ${cardBase}`}
    >
      <Dot tone={m.tone} />
      <Icon size={18} className="shrink-0 text-ink" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted">{m.title}</span>
      <span className="text-xl font-semibold leading-none tabular-nums text-ink">{m.value}</span>
    </button>
  )
}

function Panel({ m, loading, inline, onClose }) {
  const Icon = m.icon
  const items = m.items || []
  return (
    <div className={`${inline ? "" : "metric-slide-right "}relative flex w-full flex-col overflow-hidden bg-surface-2/40 p-4 sm:p-5 ${inline ? "" : "h-full"} ${cardBase} border-border-strong shadow-card`} aria-live="polite">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${TONES[m.tone]?.bar || "bg-muted"}`} aria-hidden="true" />
      <div className="metric-fade flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <Icon size={18} className="shrink-0 text-ink" />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-ink">{m.title}</span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <LayoutGrid size={12} /> Overview
          </button>
        </div>

        <div className={`mt-2 flex min-h-0 flex-1 gap-4 ${inline ? "flex-col" : "flex-col sm:flex-row"}`}>
          <div className="flex shrink-0 flex-col sm:w-[42%]">
            <span className={`text-5xl font-semibold leading-none tabular-nums text-ink transition-opacity ${loading ? "opacity-50" : ""}`}>{m.value}</span>
            <span className="mt-1.5 text-sm text-muted">{m.description}</span>
            {m.stats?.length > 0 && (
              <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                {m.stats.map((s) => (
                  <div key={s.label} className="min-w-0">
                    <dt className="text-[11px] text-muted">{s.label}</dt>
                    <dd className="text-sm font-semibold tabular-nums text-ink">{s.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {m.items && (
            <ul className={`min-h-0 flex-1 divide-y divide-border overflow-y-auto ${inline ? "max-h-48 border-t border-border" : "border-t border-border pt-2 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0"}`}>
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-2 py-1.5">
                  {it.to ? (
                    <Link to={it.to} className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink hover:text-accent">{it.primary}</Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{it.primary}</span>
                  )}
                  {it.badge && <span className="shrink-0 text-[11px] font-semibold text-warning">{it.badge}</span>}
                  {it.secondary && <span className="shrink-0 text-[11px] tabular-nums text-muted">{it.secondary}</span>}
                </li>
              ))}
              {items.length === 0 && <li className="py-4 text-center text-xs text-muted">{loading ? "Loading…" : m.emptyText}</li>}
            </ul>
          )}
        </div>

        {m.action && (
          <Link
            to={m.action.to}
            className="mt-3 inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {m.action.label}
            <ArrowRight size={14} />
          </Link>
        )}
      </div>
    </div>
  )
}

// The compact tiles on their own, for a parent that wants them somewhere else
// (e.g. in a section header) - pair with <InteractiveMetricWorkspace external />.
export function MetricNav({ metrics, activeId, onSelect, className = "" }) {
  return (
    <div className={`grid min-w-0 gap-2 ${className}`} style={{ gridTemplateColumns: `repeat(${Math.max(metrics.length - 1, 1)}, minmax(0, 1fr))` }}>
      {metrics.filter((m) => m.id !== activeId).map((m) => (
        <div key={m.id} className="metric-rise h-11">
          <CompactCard m={m} onActivate={() => onSelect(m.id)} />
        </div>
      ))}
    </div>
  )
}

/* Props beyond the above:
   activeId / onActiveChange   controlled mode (parent owns which metric is open)
   external                    wide layout only: while one is open, the workspace
                               shows just its detail panel at full height; the
                               parent renders <MetricNav /> wherever it likes. */
export default function InteractiveMetricWorkspace({ metrics, wide, loading = false, className = "", activeId: controlledId, onActiveChange, external = false }) {
  const [innerId, setInnerId] = useState(null)
  const activeId = controlledId !== undefined ? controlledId : innerId
  const setActiveId = onActiveChange || setInnerId
  const activeIndex = metrics.findIndex((m) => m.id === activeId)
  const close = () => setActiveId(null)
  const activeIdRef = activeId

  useEffect(() => {
    if (activeId == null) return
    const onKey = (e) => e.key === "Escape" && setActiveId(null)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [activeIdRef]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!wide) {
    // Phones: detail first, the other metrics as compact rows underneath.
    const active = metrics[activeIndex]
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        {active && <Panel m={active} loading={loading} inline onClose={close} />}
        {metrics.map((m) =>
          m.id === activeId ? null : (
            <button
              key={m.id}
              type="button"
              onClick={() => setActiveId(m.id)}
              aria-label={`${m.title}: ${m.value}. Show details`}
              className={`flex items-center gap-3 px-4 py-3 text-left ${cardBase}`}
            >
              <Dot tone={m.tone} />
              <m.icon size={18} className="shrink-0 text-ink" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted">{m.title}</span>
              <span className="text-xl font-semibold leading-none tabular-nums text-ink">{m.value}</span>
            </button>
          ),
        )}
      </div>
    )
  }

  if (external && activeIndex >= 0) {
    return (
      <div className={`relative h-full overflow-hidden ${className}`}>
        <Panel m={metrics[activeIndex]} loading={loading} onClose={close} />
      </div>
    )
  }

  return (
    <div className={`relative h-full overflow-hidden ${className}`}>
      {metrics.map((m, i) => (
        <div key={m.id} className="metric-box absolute" style={boxStyle(i, metrics.length, activeIndex)}>
          {activeIndex < 0 ? (
            <RestingCard m={m} loading={loading} onActivate={() => setActiveId(m.id)} />
          ) : i === activeIndex ? (
            <Panel m={m} loading={loading} onClose={close} />
          ) : (
            <CompactCard m={m} onActivate={() => setActiveId(m.id)} />
          )}
        </div>
      ))}
    </div>
  )
}
