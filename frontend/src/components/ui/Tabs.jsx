// Plain tab strip for related information. Controlled: the parent owns `value`.
// tabs: [{ key, label, count? }]. Scrolls sideways inside its own row on
// narrow screens so the page itself never overflows.
export default function Tabs({ tabs, value, onChange, className = "" }) {
  return (
    <div role="tablist" className={`no-scrollbar flex gap-1 overflow-x-auto border-b border-border ${className}`}>
      {tabs.map((t) => {
        const active = t.key === value
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {t.count != null && <span className="ml-1.5 text-xs text-muted">{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
