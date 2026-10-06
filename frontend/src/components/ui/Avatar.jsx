import { useEffect, useState } from "react"

const PALETTE = [
  "bg-chip-blue-bg text-chip-blue-fg",
  "bg-chip-purple-bg text-chip-purple-fg",
  "bg-chip-cyan-bg text-chip-cyan-fg",
  "bg-chip-orange-bg text-chip-orange-fg",
  "bg-chip-green-bg text-chip-green-fg",
  "bg-chip-pink-bg text-chip-pink-fg",
  "bg-chip-yellow-bg text-chip-yellow-fg",
]

function hash(s = "") {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const SIZE = {
  xs: "h-7 w-7 text-[11px]",
  sm: "h-9 w-9 text-xs",
  md: "h-11 w-11 text-sm",
  lg: "h-14 w-14 text-base",
  xl: "h-16 w-16 text-lg",
  "2xl": "h-24 w-24 text-3xl",
}

// Shows the person's picture when they have one (src = User.photoUrl), else
// their initial on a colour picked from their name. A broken picture falls
// back to the initial.
export default function Avatar({ name = "?", src, size = "md", className = "" }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name || ""}
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full object-cover ${SIZE[size]} ${className}`}
      />
    )
  }

  const initial = (name?.[0] || "?").toUpperCase()
  const tone = PALETTE[hash(name) % PALETTE.length]
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${SIZE[size]} ${tone} ${className}`}
    >
      {initial}
    </div>
  )
}
