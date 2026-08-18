import IconChip from "./ui/IconChip"
import TrendDelta from "./ui/TrendDelta"

export default function StatCard({
  label,
  value,
  sublabel,
  icon,
  tone = "blue",
  trend,        // { value: "35%", direction: "up" }
  className = "",
}) {
  return (
    <div className={`card relative overflow-hidden p-5 ${className}`}>
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[13px] font-medium text-muted">{label}</p>
          <IconChip icon={icon} tone={tone} size="md" />
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight text-ink" style={{ letterSpacing: "-0.03em" }}>
            {value}
          </span>
          {trend && <TrendDelta value={trend.value} direction={trend.direction} />}
        </div>
        {sublabel && <p className="mt-1 text-xs text-muted">{sublabel}</p>}
      </div>

      {/* Decorative faint curve at bottom */}
      <svg
        className="stat-curve"
        viewBox="0 0 400 80"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`grad-${tone}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0,60 C80,20 160,80 240,40 C320,10 380,50 400,30 L400,80 L0,80 Z"
          fill={`url(#grad-${tone})`}
          className={`text-chip-${tone}-fg`}
        />
      </svg>
    </div>
  )
}
