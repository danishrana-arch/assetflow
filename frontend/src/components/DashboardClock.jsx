import { useEffect, useId, useState } from "react"

function safeTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format()
    return timeZone
  } catch {
    return undefined
  }
}

// Breaks "now" into parts in the given IANA zone, so the clock follows the
// organization's timezone rather than the viewer's machine.
function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type)?.value || ""
  const hour24 = Number(get("hour")) % 24
  return {
    weekday: get("weekday").toUpperCase(),
    weekdayLong: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(date),
    day: get("day"),
    month: get("month"),
    year: get("year"),
    hour24,
    minute: Number(get("minute")),
    second: Number(get("second")),
  }
}

// tickMs: 1000 for the ticking clock; 60000 is enough for the greeting and
// avoids re-rendering the whole dashboard every second.
export function useOrgClock(timeZone, tickMs = 1000) {
  const zone = safeTimeZone(timeZone || undefined)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    // Align ticks to the start of each second/minute so the display never lags.
    let interval
    const timeout = setTimeout(() => {
      setNow(new Date())
      interval = setInterval(() => setNow(new Date()), tickMs)
    }, tickMs - (Date.now() % tickMs))
    return () => {
      clearTimeout(timeout)
      clearInterval(interval)
    }
  }, [tickMs])

  return zonedParts(now, zone)
}

export function greetingFor(hour24) {
  if (hour24 >= 5 && hour24 < 12) return "Good Morning"
  if (hour24 >= 12 && hour24 < 17) return "Good Afternoon"
  return "Good Evening"
}

// Realistic sun colours through the day: warm orange low in the morning,
// near-white yellow at midday, deep red-orange towards sunset.
function sunPalette(hour) {
  if (hour < 8) return { core: "#FFF4D6", mid: "#FFC46B", edge: "#F2703A", corona: "255,140,60" }
  if (hour < 16) return { core: "#FFFFF4", mid: "#FFF1A8", edge: "#FFBE3B", corona: "255,206,84" }
  return { core: "#FFE9C4", mid: "#FFA850", edge: "#DF4F28", corona: "250,110,50" }
}

const SKY_STYLES = `
  @keyframes dash-flip-top { from { transform: rotateX(0deg); } to { transform: rotateX(-90deg); } }
  @keyframes dash-flip-bottom { from { transform: rotateX(90deg); } to { transform: rotateX(0deg); } }
  .dash-flip-top { animation: dash-flip-top 300ms ease-in forwards; backface-visibility: hidden; }
  .dash-flip-bottom { transform: rotateX(90deg); animation: dash-flip-bottom 300ms ease-out 300ms forwards; backface-visibility: hidden; }
  @media (prefers-reduced-motion: reduce) { .dash-flip-top, .dash-flip-bottom { display: none; } }
`

// Sun by day, moon by night, at the header's right edge. Re-renders once a
// minute — its colour only changes slowly.
export function DashboardSky({ timeZone, className = "" }) {
  const { hour24, minute } = useOrgClock(timeZone, 60000)
  const hour = hour24 + minute / 60
  const isDay = hour >= 6 && hour < 18.5
  const name = isDay ? "Sun" : "Moon"
  return (
    <div className={className}>
      <div aria-hidden="true" className="h-full w-full">
        {isDay ? <RealSun palette={sunPalette(hour)} /> : <RealMoon />}
      </div>
      {/* Hover target over the disk only (r=30 of the 100-unit viewBox, i.e.
          the middle 60%) — the wrapper itself stays pointer-events-none so
          the glow never blocks clicks. The label sits to the disk's left,
          since the right half is clipped by the header's edge. */}
      <div
        className="group pointer-events-auto absolute left-[20%] top-[20%] h-[60%] w-[60%] rounded-full"
        role="img"
        aria-label={name}
      >
        <span className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink-strong px-2 py-1 text-[11px] font-semibold text-on-strong opacity-0 shadow-pop transition-opacity duration-150 group-hover:opacity-100">
          {name}
        </span>
      </div>
    </div>
  )
}

// SVG ids must be unique per instance; React's useId contains colons, which
// break url(#…) references in some browsers.
function useSvgId(prefix) {
  return `${prefix}${useId().replace(/:/g, "")}`
}

function RealSun({ palette }) {
  const id = useSvgId("sun")
  const { core, mid, edge, corona } = palette
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" overflow="visible">
      <defs>
        <radialGradient id={`${id}-corona`}>
          <stop offset="0.3" stopColor={`rgb(${corona})`} stopOpacity="0.85" />
          <stop offset="0.45" stopColor={`rgb(${corona})`} stopOpacity="0.35" />
          <stop offset="0.7" stopColor={`rgb(${corona})`} stopOpacity="0.1" />
          <stop offset="1" stopColor={`rgb(${corona})`} stopOpacity="0" />
        </radialGradient>
        {/* Limb darkening: bright centre, deeper colour at the rim. */}
        <radialGradient id={`${id}-disk`} cx="0.48" cy="0.46" r="0.56">
          <stop offset="0" stopColor={core} />
          <stop offset="0.55" stopColor={mid} />
          <stop offset="1" stopColor={edge} />
        </radialGradient>
        {/* Fine granulation texture on the surface. */}
        <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="7" />
          <feColorMatrix values="0 0 0 0 0.85  0 0 0 0 0.35  0 0 0 0 0.05  0 0 0 0.55 -0.12" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
      </defs>
      <circle cx="50" cy="50" r="50" fill={`url(#${id}-corona)`} />
      <circle cx="50" cy="50" r="30" fill={`url(#${id}-disk)`} />
      <circle cx="50" cy="50" r="30" fill="#fff" filter={`url(#${id}-grain)`} opacity="0.5" />
    </svg>
  )
}

// Full moon with its main maria and a few bright craters, roughly where they
// sit on the real near side.
const MARIA = [
  [40, 37, 10, 8], [58, 36, 6.5, 6], [64, 49, 8, 7], [31, 53, 8, 13],
  [45, 65, 7, 5], [75, 42, 4, 4.5], [70, 61, 4.5, 6], [53, 50, 4, 3.5],
]
const CRATERS = [
  [48, 74, 2.6], [38, 49, 2], [28, 40, 1.6], [62, 70, 1.8], [72, 30, 1.4], [56, 25, 1.5],
]

function RealMoon() {
  const id = useSvgId("moon")
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" overflow="visible">
      <defs>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0.3" stopColor="#DDE4F5" stopOpacity="0.75" />
          <stop offset="0.5" stopColor="#DDE4F5" stopOpacity="0.25" />
          <stop offset="1" stopColor="#DDE4F5" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-disk`} cx="0.42" cy="0.4" r="0.62">
          <stop offset="0" stopColor="#FBFAF4" />
          <stop offset="0.6" stopColor="#E3E0D5" />
          <stop offset="1" stopColor="#B4B0A3" />
        </radialGradient>
        <radialGradient id={`${id}-shade`} cx="0.3" cy="0.3" r="0.8">
          <stop offset="0.55" stopColor="#2A3040" stopOpacity="0" />
          <stop offset="1" stopColor="#2A3040" stopOpacity="0.35" />
        </radialGradient>
        <radialGradient id={`${id}-crater`}>
          <stop offset="0" stopColor="#8E8A7E" stopOpacity="0.55" />
          <stop offset="0.7" stopColor="#8E8A7E" stopOpacity="0.25" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.7" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="50" cy="50" r="30" />
        </clipPath>
        <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
        <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="3" />
          <feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.34  0 0 0 0 0.3  0 0 0 0.6 -0.15" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
      </defs>
      <circle cx="50" cy="50" r="50" fill={`url(#${id}-glow)`} />
      <circle cx="50" cy="50" r="30" fill={`url(#${id}-disk)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <g filter={`url(#${id}-soft)`} fill="#8A877C" opacity="0.5">
          {MARIA.map(([cx, cy, rx, ry], i) => (
            <ellipse key={i} cx={50 + (cx - 50) * 0.88} cy={50 + (cy - 50) * 0.88} rx={rx * 0.88} ry={ry * 0.88} />
          ))}
        </g>
        {CRATERS.map(([cx, cy, r], i) => (
          <circle key={i} cx={50 + (cx - 50) * 0.88} cy={50 + (cy - 50) * 0.88} r={r} fill={`url(#${id}-crater)`} />
        ))}
        <circle cx="50" cy="50" r="30" fill="#fff" filter={`url(#${id}-grain)`} opacity="0.45" />
        <circle cx="50" cy="50" r="30" fill={`url(#${id}-shade)`} />
      </g>
    </svg>
  )
}

/* Flip-clock digit card. When the value changes, the old top half folds down
   over the new one (and the new bottom half follows), like a real split-flap
   clock. Halves are two clipped copies of the same full-height glyph. */
const FLIP_MS = 600

// Colours come from the theme tokens, so the cards match the header in light
// mode (cream card, dark digits) and dark mode (dark card, light digits). The
// bottom flap is a touch darker, like light falling on a real flip clock.
function Half({ value, part }) {
  return (
    <div
      className={`absolute inset-x-0 h-1/2 overflow-hidden ${part === "top" ? "top-0 rounded-t-[10px]" : "bottom-0 rounded-b-[10px]"}`}
      style={{
        background: part === "top"
          ? "var(--surface-2)"
          : "color-mix(in srgb, var(--surface-2) 93%, var(--ink) 7%)",
        border: "1px solid var(--border)",
        [part === "top" ? "borderBottom" : "borderTop"]: "none",
      }}
    >
      <span
        className="absolute inset-x-0 flex h-[200%] items-center justify-center font-semibold tabular-nums"
        style={{ top: part === "top" ? 0 : "-100%", color: "var(--ink)" }}
      >
        {value}
      </span>
    </div>
  )
}

function FlipDigit({ value }) {
  const [shown, setShown] = useState(value) // value the static bottom half still shows
  const flipping = shown !== value

  useEffect(() => {
    if (shown === value) return
    const t = setTimeout(() => setShown(value), FLIP_MS)
    return () => clearTimeout(t)
  }, [value, shown])

  return (
    <div
      className="relative h-[68px] w-[48px] text-[50px] leading-none sm:h-[80px] sm:w-[56px] sm:text-[60px]"
      style={{ perspective: "300px", filter: "drop-shadow(0 4px 8px rgba(0,0,0,.12))" }}
    >
      <Half value={value} part="top" />
      <Half value={shown} part="bottom" />
      {flipping && (
        <>
          <div key={`t${value}`} className="dash-flip-top absolute inset-0" style={{ transformOrigin: "50% 50%" }}>
            <Half value={shown} part="top" />
          </div>
          <div key={`b${value}`} className="dash-flip-bottom absolute inset-0" style={{ transformOrigin: "50% 50%" }}>
            <Half value={value} part="bottom" />
          </div>
        </>
      )}
      {/* Split line + hinge pins across the middle. */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2" style={{ background: "var(--border-strong)" }} />
      <div className="pointer-events-none absolute -left-[2px] top-1/2 h-2 w-[4px] -translate-y-1/2 rounded-sm" style={{ background: "var(--border-strong)" }} />
      <div className="pointer-events-none absolute -right-[2px] top-1/2 h-2 w-[4px] -translate-y-1/2 rounded-sm" style={{ background: "var(--border-strong)" }} />
    </div>
  )
}

export default function DashboardClock({ timeZone }) {
  const clock = useOrgClock(timeZone, 60000)
  const hour12 = clock.hour24 % 12 || 12
  const ampm = clock.hour24 < 12 ? "AM" : "PM"
  const hh = String(hour12).padStart(2, "0")
  const mm = String(clock.minute).padStart(2, "0")

  return (
    <div
      className="flex shrink-0 flex-col items-center self-center"
      role="timer"
      aria-label={`${hh}:${mm} ${ampm}, ${clock.weekdayLong}, ${clock.day} ${clock.month}, ${clock.year}`}
    >
      <style>{SKY_STYLES}</style>
      <div className="relative flex items-center gap-3 sm:gap-4" aria-hidden="true">
        <div className="flex gap-1.5">
          <FlipDigit value={hh[0]} />
          <FlipDigit value={hh[1]} />
        </div>
        <div className="flex gap-1.5">
          <FlipDigit value={mm[0]} />
          <FlipDigit value={mm[1]} />
        </div>
        {/* Absolutely placed so the day/date stay centred under the digits. */}
        <span className="absolute left-full top-0 ml-1.5 text-[10px] font-bold leading-none tracking-[0.1em] text-ink">
          {ampm}
        </span>
      </div>
      <div className="mt-2 flex flex-col items-center" aria-hidden="true">
        <span className="text-xs font-medium tracking-wide text-muted">{clock.weekdayLong}</span>
        <span className="mt-0.5 text-[11px] font-medium text-muted">
          {clock.day} {clock.month}, {clock.year}
        </span>
      </div>
    </div>
  )
}
