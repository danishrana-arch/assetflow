import StatusPill from "../ui/StatusPill"

const SOURCE = {
  PLAN: { text: "From plan", tone: "slate" },
  OVERRIDE: { text: "Override", tone: "blue" },
  PLATFORM_OFF: { text: "Off platform-wide", tone: "pink" },
  NO_PLAN: { text: "No plan", tone: "yellow" },
}

/* One feature switch row — availability, entitlement or any other on/off.
   source: where the current value comes from (see SOURCE); `locked` disables
   the switch (e.g. the feature is off platform-wide). */
export default function FeatureToggle({ label, description, checked, onChange, source, locked, busy, trailing }) {
  const s = source && SOURCE[source]
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-surface px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          {label}
          {s && <StatusPill tone={s.tone}>{s.text}</StatusPill>}
        </p>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        {trailing}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        aria-label={label}
        disabled={locked || busy}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-accent" : "bg-border"}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
    </div>
  )
}
