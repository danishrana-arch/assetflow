import { useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight } from "lucide-react"

/* Reusable expandable metric group.

   metrics: [{
     id, title, value, icon, tone ("blue"|"green"|"amber"|"red"),
     description,                       // what the value means
     stats: [{ label, value }],         // related figures (already real data)
     items: [{ id, primary, secondary, badge, to }],  // optional people/rows list
     emptyText, loading,
     action: { label, to }              // optional, only followed on click
   }]
   wide: desktop/tablet layout (hover + focus + tap); false → stacked accordion.

   Desktop: four equal cards. The active one grows into a detail panel on the
   right and the other three become a compact column on the left; moving
   between cards or into the panel keeps it open, leaving the whole area
   restores the row. All boxes are positioned from the same state so the
   change is one CSS transition (no layout jumps, nothing overlaps). */

const TONES = {
  blue: { dot: "bg-info", bar: "bg-info" },
  green: { dot: "bg-success", bar: "bg-success" },
  amber: { dot: "bg-warning", bar: "bg-warning" },
  red: { dot: "bg-danger", bar: "bg-danger" },
}

const GAP = "10px"
const STRIP_H = "52px"

// Resting: four equal columns. Open: the other metrics become a strip along
// the top and the active one fills the space below.
function boxStyle(index, count, activeIndex) {
  const ease = "left 380ms cubic-bezier(0.22,1,0.36,1), top 380ms cubic-bezier(0.22,1,0.36,1), width 380ms cubic-bezier(0.22,1,0.36,1), height 380ms cubic-bezier(0.22,1,0.36,1)"
  if (activeIndex < 0) {
    return {
      left: `calc(${index} * (100% + ${GAP}) / ${count})`,
      top: 0,
      width: `calc((100% + ${GAP}) / ${count} - ${GAP})`,
      height: "100%",
      transition: ease,
    }
  }
  if (index === activeIndex) {
    return { left: 0, top: `calc(${STRIP_H} + ${GAP})`, width: "100%", height: `calc(100% - ${STRIP_H} - ${GAP})`, transition: ease }
  }
  const slot = index < activeIndex ? index : index - 1
  const others = count - 1
  return {
    left: `calc(${slot} * (100% + ${GAP}) / ${others})`,
    top: 0,
    width: `calc((100% + ${GAP}) / ${others} - ${GAP})`,
    height: STRIP_H,
    transition: ease,
  }
}

const cardBase =
  "min-w-0 rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"

function Dot({ tone }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${TONES[tone]?.dot || "bg-muted"}`} aria-hidden="true" />
}

// Default card: icon + label on top, number at the bottom.
function RestingCard({ m, onActivate, loading }) {
  const Icon = m.icon
  return (
    <button
      type="button"
      onClick={onActivate}
      onFocus={onActivate}
      aria-label={`${m.title}: ${m.value}. Show details`}
      className={`metric-fade flex h-full w-full flex-col p-4 text-left transition-colors hover:bg-surface-2/60 ${cardBase}`}
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

// Compact navigation item shown while another metric is open.
function CompactCard({ m, onActivate }) {
  const Icon = m.icon
  return (
    <button
      type="button"
      onClick={onActivate}
      onFocus={onActivate}
      aria-label={`${m.title}: ${m.value}. Show details`}
      className={`metric-fade flex h-full w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-surface-2/60 ${cardBase}`}
    >
      <Icon size={18} className="shrink-0 text-ink" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted">{m.title}</span>
      <span className="text-lg font-semibold leading-none text-ink">{m.value}</span>
    </button>
  )
}

function Panel({ m, loading, inline }) {
  const Icon = m.icon
  const items = m.items || []
  return (
    <div
      className={`metric-fade relative flex w-full flex-col overflow-hidden p-4 ${inline ? "" : "h-full"} ${cardBase}`}
      aria-live="polite"
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${TONES[m.tone]?.bar || "bg-muted"}`} aria-hidden="true" />
      <div className="flex items-center gap-2">
        <Icon size={20} className="shrink-0 text-ink" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted">{m.title}</span>
        {m.action && (
          <Link
            to={m.action.to}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {m.action.label}
            <ArrowRight size={12} />
          </Link>
        )}
      </div>

      <div className={`mt-2 flex min-h-0 flex-1 gap-4 ${inline ? "flex-col" : ""}`}>
        <div className="flex shrink-0 flex-col sm:w-[44%]">
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
          <ul className={`min-h-0 flex-1 divide-y divide-border overflow-y-auto ${inline ? "max-h-48 border-t border-border" : "border-l border-border pl-4"}`}>
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
    </div>
  )
}

export default function InteractiveMetricWorkspace({ metrics, wide, loading = false, className = "" }) {
  const [activeId, setActiveId] = useState(null)
  const activeIndex = metrics.findIndex((m) => m.id === activeId)
  const toggle = (id) => setActiveId((cur) => (wide ? id : cur === id ? null : id))

  if (!wide) {
    // Stacked accordion: tap a row to open it inline, the rest stay one tap away.
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        {metrics.map((m) =>
          m.id === activeId ? (
            <div key={m.id}>
              <button type="button" onClick={() => toggle(m.id)} aria-expanded="true" className="sr-only">
                Collapse {m.title}
              </button>
              <Panel m={m} loading={loading} inline />
            </div>
          ) : (
            <button
              key={m.id}
              type="button"
              aria-expanded="false"
              onClick={() => toggle(m.id)}
              className={`flex items-center gap-3 px-4 py-3 text-left ${cardBase}`}
            >
              <Dot tone={m.tone} />
              <m.icon size={18} className="shrink-0 text-ink" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted">{m.title}</span>
              <span className="text-xl font-semibold leading-none text-ink">{m.value}</span>
            </button>
          ),
        )}
      </div>
    )
  }

  return (
    <div
      className={`relative h-full ${className}`}
      onMouseLeave={() => setActiveId(null)}
      onKeyDown={(e) => e.key === "Escape" && setActiveId(null)}
    >
      {metrics.map((m, i) => (
        <div
          key={m.id}
          className="metric-box absolute"
          style={boxStyle(i, metrics.length, activeIndex)}
          onMouseEnter={() => activeIndex < 0 && setActiveId(m.id)}
        >
          {activeIndex < 0 ? (
            <RestingCard m={m} loading={loading} onActivate={() => setActiveId(m.id)} />
          ) : i === activeIndex ? (
            <Panel m={m} loading={loading} />
          ) : (
            <CompactCard m={m} onActivate={() => setActiveId(m.id)} />
          )}
        </div>
      ))}
    </div>
  )
}
