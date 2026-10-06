// Icon "chip": black & white icon with no background (design decision
// 2026-10-06 — no coloured circles behind icons). `tone` is accepted and
// ignored so existing callers keep working; the box keeps its size so
// layouts don't shift.
const SIZES = {
  sm: "h-9 w-9",
  md: "h-11 w-11",
  lg: "h-12 w-12",
}

const TONES = ["blue", "purple", "cyan", "orange", "green", "pink", "yellow", "slate"]

// eslint-disable-next-line no-unused-vars
export default function IconChip({ icon: Icon, tone, size = "md", className = "" }) {
  return (
    <div className={`flex shrink-0 items-center justify-center text-ink ${SIZES[size] || SIZES.md} ${className}`}>
      {Icon && <Icon size={size === "sm" ? 20 : 24} />}
    </div>
  )
}

export const CHIP_TONES = TONES
