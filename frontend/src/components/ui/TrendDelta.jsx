import { TrendingUp, TrendingDown } from "lucide-react"

export default function TrendDelta({ value, direction = "up", className = "" }) {
  const isUp = direction === "up"
  const color = isUp ? "text-chip-green-fg" : "text-danger"
  const Icon = isUp ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${color} ${className}`}>
      <Icon size={12} strokeWidth={2.5} />
      {value}
    </span>
  )
}
