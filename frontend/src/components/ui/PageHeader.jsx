import BackButton from "./BackButton"

// Renders the AssetFlow "Executive" page-header pattern: the circular back
// button (always — it returns to the page the user came from; `backTo` is
// only the fallback when there's no previous page; `back={false}` hides it),
// a bold display-style title (pass a literal "\n" in the string for the
// signature two-line look), an optional subtitle, an optional inline stat
// strip, and right-aligned actions.
export default function PageHeader({ title, subtitle, backTo, back = true, stats, actions, className = "" }) {
  return (
    <div className={`mb-6 flex flex-col gap-5 ${className}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          {back && <BackButton fallback={backTo || "/"} />}
          <div>
            <h1
              className="whitespace-pre-line text-[28px] font-extrabold leading-[1.1] text-ink sm:text-[36px]"
              style={{ letterSpacing: "-0.02em" }}
            >
              {title}
            </h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{actions}</div>}
      </div>

      {stats && stats.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {stats.map((s, i) => (
            <div
              key={i}
              className={`relative flex flex-col gap-1.5 overflow-hidden rounded-card p-4 shadow-card sm:p-5 ${
                s.highlight ? "text-white" : "bg-surface"
              }`}
              style={s.highlight ? { backgroundColor: "var(--primary-container)" } : undefined}
            >
              <div className={`label-caps flex items-center gap-1.5 ${s.highlight ? "text-white/80" : ""}`}>
                {s.icon && <s.icon size={14} className={s.highlight ? "" : "text-ink"} />}
                {s.label}
              </div>
              <div className="text-2xl font-bold" style={{ letterSpacing: "-0.01em" }}>
                {s.value}
              </div>
              {s.trend && (
                <span className="absolute right-4 top-4 rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-semibold">
                  {s.trend}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
