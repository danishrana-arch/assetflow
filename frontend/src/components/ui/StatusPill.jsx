const VARIANTS = {
  blue: "bg-chip-blue-bg text-chip-blue-fg",
  purple: "bg-chip-purple-bg text-chip-purple-fg",
  cyan: "bg-chip-cyan-bg text-chip-cyan-fg",
  orange: "bg-chip-orange-bg text-chip-orange-fg",
  green: "bg-chip-green-bg text-chip-green-fg",
  pink: "bg-chip-pink-bg text-chip-pink-fg",
  yellow: "bg-chip-yellow-bg text-chip-yellow-fg",
  slate: "bg-chip-slate-bg text-chip-slate-fg",
}

export default function StatusPill({ children, tone = "slate", icon: Icon, className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
        VARIANTS[tone] || VARIANTS.slate
      } ${className}`}
    >
      {Icon && <Icon size={11} strokeWidth={2.5} />}
      {children}
    </span>
  )
}
