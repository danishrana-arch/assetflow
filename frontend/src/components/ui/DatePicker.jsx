import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"

// The app's calendar (replaces the browser's native date picker everywhere).
// Values are plain "YYYY-MM-DD" strings, exactly like <input type="date">.
//   <DateInput value onChange={(e) => e.target.value} min max required … />
//     — drop-in for <input type="date"> (onChange gets an event-like object).
//   <DateRangeInput from to onChange={({ from, to }) => …} min max />
//     — range with quick presets (This week, Last 7 days, …) + Cancel / Apply.
// Week starts on Monday. The popover is portaled to <body> (a transformed
// ancestor would otherwise trap `position: fixed`).

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3))
const WEEK = ["M", "T", "W", "T", "F", "S", "S"]

const pad = (n) => String(n).padStart(2, "0")
const toKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}` // m: 0-11
function parseKey(key) {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  const [y, m, d] = key.split("-").map(Number)
  return { y, m: m - 1, d }
}
function todayKey() {
  const t = new Date()
  return toKey(t.getFullYear(), t.getMonth(), t.getDate())
}
function addDays(key, n) {
  const p = parseKey(key)
  const d = new Date(p.y, p.m, p.d + n)
  return toKey(d.getFullYear(), d.getMonth(), d.getDate())
}
function addMonths(key, n) {
  const p = parseKey(key)
  const d = new Date(p.y, p.m + n, 1)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return toKey(d.getFullYear(), d.getMonth(), Math.min(p.d, last))
}
export function formatDateKey(key, { year = true } = {}) {
  const p = parseKey(key)
  if (!p) return ""
  return `${SHORT_MONTHS[p.m]} ${p.d}${year ? `, ${p.y}` : ""}`
}
function formatRange(from, to) {
  if (!from) return ""
  if (!to || to === from) return formatDateKey(from)
  const a = parseKey(from)
  const b = parseKey(to)
  if (a.y === b.y && a.m === b.m) return `${SHORT_MONTHS[a.m]} ${a.d} – ${b.d}, ${a.y}`
  if (a.y === b.y) return `${SHORT_MONTHS[a.m]} ${a.d} – ${SHORT_MONTHS[b.m]} ${b.d}, ${a.y}`
  return `${formatDateKey(from)} – ${formatDateKey(to)}`
}
const clamp = (key, min, max) => (min && key < min ? min : max && key > max ? max : key)

// ── Popover anchored to a trigger, portaled to <body> ─────────────────────
function usePopover(width) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const popRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const place = useCallback(() => {
    const el = triggerRef.current
    const pop = popRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const h = pop?.offsetHeight || 380
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = Math.min(width, vw - 16)
    let left = r.left
    if (left + w > vw - 8) left = Math.max(8, r.right - w)
    let top = r.bottom + 6
    if (top + h > vh - 8 && r.top - h - 6 > 8) top = r.top - h - 6
    setPos({ top: Math.max(8, top), left, width: w })
  }, [width])

  useLayoutEffect(() => {
    if (!open) return
    place()
    const raf = requestAnimationFrame(place)
    return () => cancelAnimationFrame(raf)
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus() } }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [open, place])

  return { open, setOpen, triggerRef, popRef, pos }
}

function Popover({ pop, children, label }) {
  if (!pop.open) return null
  return createPortal(
    <div
      ref={pop.popRef}
      role="dialog"
      aria-label={label}
      style={{ position: "fixed", top: pop.pos.top, left: pop.pos.left, width: pop.pos.width, zIndex: 80 }}
      onMouseDown={(e) => e.stopPropagation()}
      className="rounded-2xl border border-border bg-surface p-4 text-ink shadow-pop"
    >
      {children}
    </div>,
    document.body
  )
}

// ── Month grid with month arrows and a year dropdown ──────────────────────
function Calendar({ view, setView, min, max, isSelected, isInRange, isEdge, onPick, onHover }) {
  const [yearsOpen, setYearsOpen] = useState(false)
  const [yearPage, setYearPage] = useState(() => view.y - (view.y % 12))
  const today = todayKey()

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1)
    const lead = (first.getDay() + 6) % 7 // Monday-first
    const start = new Date(view.y, view.m, 1 - lead)
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      return { key: toKey(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: d.getMonth() === view.m }
    })
  }, [view.y, view.m])

  const shift = (n) => {
    const d = new Date(view.y, view.m + n, 1)
    setView({ y: d.getFullYear(), m: d.getMonth() })
  }
  const minYear = min ? parseKey(min).y : null
  const maxYear = max ? parseKey(max).y : null

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shift(-1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-surface-2" aria-label="Previous month">
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-[92px] text-center text-sm font-semibold">{MONTHS[view.m]}</span>
          <button type="button" onClick={() => shift(1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-surface-2" aria-label="Next month">
            <ChevronRight size={15} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => { setYearPage(view.y - (view.y % 12)); setYearsOpen((v) => !v) }}
          aria-expanded={yearsOpen}
          className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-semibold ${yearsOpen ? "border-accent text-accent" : "border-border hover:bg-surface-2"}`}
        >
          {view.y} <ChevronDown size={14} className={yearsOpen ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>
      </div>

      {yearsOpen ? (
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            <button type="button" onClick={() => setYearPage((y) => y - 12)} className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-surface-2" aria-label="Earlier years"><ChevronLeft size={14} /></button>
            <span>{yearPage} – {yearPage + 11}</span>
            <button type="button" onClick={() => setYearPage((y) => y + 12)} className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-surface-2" aria-label="Later years"><ChevronRight size={14} /></button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 12 }, (_, i) => yearPage + i).map((y) => {
              const disabled = (minYear !== null && y < minYear) || (maxYear !== null && y > maxYear)
              const active = y === view.y
              return (
                <button
                  key={y}
                  type="button"
                  disabled={disabled}
                  onClick={() => { setView({ y, m: view.m }); setYearsOpen(false) }}
                  className={`rounded-lg border py-2 text-sm font-medium ${active ? "border-accent bg-accent text-on-accent" : "border-border hover:bg-surface-2"} disabled:opacity-35 disabled:hover:bg-transparent`}
                >
                  {y}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div onMouseLeave={() => onHover?.(null)}>
          <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-semibold text-muted-2">
            {WEEK.map((w, i) => <span key={i} className="py-1">{w}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-y-1">
            {cells.map((c) => {
              const disabled = (min && c.key < min) || (max && c.key > max)
              const selected = isSelected(c.key)
              const inRange = isInRange?.(c.key)
              const edge = isEdge?.(c.key)
              const isToday = c.key === today
              return (
                <div key={c.key} className={`flex justify-center ${inRange ? "bg-accent-soft" : ""} ${edge === "start" ? "rounded-l-lg" : edge === "end" ? "rounded-r-lg" : ""}`}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onPick(c.key)}
                    onMouseEnter={() => onHover?.(c.key)}
                    aria-label={formatDateKey(c.key)}
                    aria-pressed={selected}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm tabular-nums transition-colors
                      ${selected ? "bg-accent font-semibold text-on-accent" : inRange ? "text-ink hover:bg-surface" : "hover:bg-surface-2"}
                      ${!c.inMonth && !selected ? "text-muted-2" : ""}
                      ${isToday && !selected ? "font-bold ring-1 ring-inset ring-accent" : ""}
                      disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent`}
                  >
                    {c.day}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function Trigger({ triggerRef, open, onClick, disabled, className, text, placeholder, id, ariaLabel }) {
  const base = /\bfield\b/.test(className || "") ? className : `field w-full ${className || ""}`
  return (
    <button
      ref={triggerRef}
      id={id}
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={ariaLabel}
      className={`${base} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <span className={`truncate ${text ? "text-ink" : "text-muted-2"}`}>{text || placeholder}</span>
      <CalendarDays size={15} className="shrink-0 text-muted" />
    </button>
  )
}

// ── Single date — drop-in for <input type="date"> ─────────────────────────
export function DateInput({
  value = "", onChange, min, max, disabled, required, className = "", placeholder = "Select date",
  id, name, "aria-label": ariaLabel, onBlur, renderTrigger,
}) {
  const pop = usePopover(304)
  const initial = parseKey(value) || parseKey(clamp(todayKey(), min, max))
  const [view, setView] = useState({ y: initial.y, m: initial.m })
  const generatedId = useId()

  function openPicker() {
    const p = parseKey(value) || parseKey(clamp(todayKey(), min, max))
    setView({ y: p.y, m: p.m })
    pop.setOpen((v) => !v)
  }
  function commit(key) {
    onChange?.({ target: { value: key, name }, currentTarget: { value: key, name } })
    pop.setOpen(false)
    onBlur?.()
    pop.triggerRef.current?.focus()
  }
  const today = todayKey()
  const todayAllowed = !(min && today < min) && !(max && today > max)

  return (
    <span className={renderTrigger ? "relative inline-block" : "relative block"}>
      {renderTrigger ? (
        renderTrigger({ ref: pop.triggerRef, onClick: openPicker, open: pop.open })
      ) : (
        <Trigger
          triggerRef={pop.triggerRef}
          open={pop.open}
          onClick={openPicker}
          disabled={disabled}
          className={className}
          text={formatDateKey(value)}
          placeholder={placeholder}
          id={id}
          ariaLabel={ariaLabel}
        />
      )}
      {/* Keeps native form validation for required fields. */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value || ""}
          onChange={() => {}}
          name={name}
          id={`${generatedId}-v`}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
        />
      )}
      <Popover pop={pop} label="Choose a date">
        <Calendar view={view} setView={setView} min={min} max={max} isSelected={(k) => k === value} onPick={commit} />
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
          <button type="button" disabled={!todayAllowed} onClick={() => commit(today)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 disabled:opacity-40">
            Today
          </button>
          <div className="flex gap-2">
            {!required && value && (
              <button type="button" onClick={() => commit("")} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2">
                Clear
              </button>
            )}
            <button type="button" onClick={() => pop.setOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2">
              Cancel
            </button>
          </div>
        </div>
      </Popover>
    </span>
  )
}

// ── Date range with presets ───────────────────────────────────────────────
function presetRanges(max) {
  const t = todayKey()
  const p = parseKey(t)
  const dow = (new Date(p.y, p.m, p.d).getDay() + 6) % 7 // 0 = Monday
  const monthStart = toKey(p.y, p.m, 1)
  const monthEnd = toKey(p.y, p.m, new Date(p.y, p.m + 1, 0).getDate())
  const prev = new Date(p.y, p.m - 1, 1)
  const prevStart = toKey(prev.getFullYear(), prev.getMonth(), 1)
  const prevEnd = toKey(prev.getFullYear(), prev.getMonth(), new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate())
  const cap = (k) => (max && k > max ? max : k)
  return [
    ["Today", t, t],
    ["This Week", addDays(t, -dow), cap(addDays(t, 6 - dow))],
    ["Last 7 days", addDays(t, -6), t],
    ["This Month", monthStart, cap(monthEnd)],
    ["Last 30 days", addDays(t, -29), t],
    ["Last Month", prevStart, prevEnd],
    ["Last 3 Months", addDays(addMonths(t, -3), 1), t],
    ["Last 6 Months", addDays(addMonths(t, -6), 1), t],
  ]
}

export function DateRangeInput({
  from = "", to = "", onChange, min, max, disabled, className = "", placeholder = "Select dates", presets = true, "aria-label": ariaLabel, renderTrigger,
}) {
  const pop = usePopover(presets ? 360 : 320)
  const [draft, setDraft] = useState({ from, to })
  const [hover, setHover] = useState(null)
  const start = parseKey(from) || parseKey(clamp(todayKey(), min, max))
  const [view, setView] = useState({ y: start.y, m: start.m })

  function openPicker() {
    setDraft({ from, to })
    setHover(null)
    const p = parseKey(from) || parseKey(clamp(todayKey(), min, max))
    setView({ y: p.y, m: p.m })
    pop.setOpen((v) => !v)
  }
  function pick(key) {
    setDraft((d) => {
      if (!d.from || (d.from && d.to)) return { from: key, to: "" }
      return key < d.from ? { from: key, to: d.from } : { from: d.from, to: key }
    })
  }
  function applyPreset(a, b) {
    const f = clamp(a, min, max)
    const t = clamp(b, min, max)
    setDraft({ from: f, to: t })
    const p = parseKey(f)
    setView({ y: p.y, m: p.m })
  }
  // While choosing the end, preview the range to the hovered day.
  const endPreview = draft.from && !draft.to && hover ? hover : draft.to
  const lo = draft.from && endPreview ? (endPreview < draft.from ? endPreview : draft.from) : draft.from
  const hi = draft.from && endPreview ? (endPreview < draft.from ? draft.from : endPreview) : draft.to
  const activePreset = presets ? presetRanges(max).find(([, a, b]) => clamp(a, min, max) === draft.from && clamp(b, min, max) === draft.to)?.[0] : null

  return (
    <span className={renderTrigger ? "relative inline-block" : "relative block"}>
      {renderTrigger ? (
        renderTrigger({ ref: pop.triggerRef, onClick: openPicker, open: pop.open, text: formatRange(from, to) })
      ) : (
        <Trigger
          triggerRef={pop.triggerRef}
          open={pop.open}
          onClick={openPicker}
          disabled={disabled}
          className={className}
          text={formatRange(from, to)}
          placeholder={placeholder}
          ariaLabel={ariaLabel}
        />
      )}
      <Popover pop={pop} label="Choose a date range">
        {presets && (
          <div className="mb-3">
            <p className="mb-2 text-xs font-semibold text-muted">Select For</p>
            <div className="grid grid-cols-4 gap-1.5">
              {presetRanges(max).map(([label, a, b]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => applyPreset(a, b)}
                  className={`rounded-lg border px-1 py-1.5 text-[11px] font-medium leading-tight ${activePreset === label ? "border-accent bg-accent-soft font-semibold text-ink" : "border-border hover:bg-surface-2"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <Calendar
          view={view}
          setView={setView}
          min={min}
          max={max}
          isSelected={(k) => k === draft.from || k === draft.to}
          isInRange={(k) => lo && hi && k >= lo && k <= hi && lo !== hi}
          isEdge={(k) => (lo && hi && lo !== hi ? (k === lo ? "start" : k === hi ? "end" : null) : null)}
          onPick={pick}
          onHover={setHover}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p className="text-[11px] text-muted">
            Range: <span className="font-semibold text-ink">{draft.from ? formatRange(draft.from, draft.to || draft.from) : "—"}</span>
            {draft.from && !draft.to && <span className="text-muted-2"> · pick an end date</span>}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => pop.setOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2">
              Cancel
            </button>
            <button
              type="button"
              disabled={!draft.from}
              onClick={() => { onChange?.({ from: draft.from, to: draft.to || draft.from }); pop.setOpen(false) }}
              className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-on-accent hover:opacity-90 disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </div>
      </Popover>
    </span>
  )
}

export default DateInput
