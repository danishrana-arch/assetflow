const TONES = {
  blue: "bg-chip-blue-bg text-chip-blue-fg",
  purple: "bg-chip-purple-bg text-chip-purple-fg",
  cyan: "bg-chip-cyan-bg text-chip-cyan-fg",
  orange: "bg-chip-orange-bg text-chip-orange-fg",
  green: "bg-chip-green-bg text-chip-green-fg",
  pink: "bg-chip-pink-bg text-chip-pink-fg",
  yellow: "bg-chip-yellow-bg text-chip-yellow-fg",
  slate: "bg-chip-slate-bg text-chip-slate-fg",
}

const SIZES = {
  sm: "h-9 w-9 rounded-xl",
  md: "h-11 w-11 rounded-2xl",
  lg: "h-12 w-12 rounded-2xl",
}

export default function IconChip({ icon: Icon, tone = "blue", size = "md", className = "" }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center ${SIZES[size]} ${TONES[tone] || TONES.blue} ${className}`}
    >
      {Icon && <Icon size={size === "sm" ? 16 : 20} strokeWidth={2} />}
    </div>
  )
}

export const CHIP_TONES = Object.keys(TONES)
