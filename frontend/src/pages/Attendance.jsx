import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useSearchParams } from "react-router-dom"
import {
  Save, Download, CheckCircle2, XCircle, Palmtree, MapPin, AlertTriangle, ShieldAlert, X,
  ChevronLeft, ChevronRight, CalendarDays, Search, SlidersHorizontal, LayoutGrid, List,
  ClipboardCheck, ClipboardX, CalendarOff, FileBarChart, ArrowUp, ArrowDown,
  ArrowUpDown, User, Clock, Timer, StickyNote, ChevronDown, Check, Plus, Pencil, Fingerprint, Home,
  Trash2, Wallet,
} from "lucide-react"
import api from "../api/client"
import BackButton from "../components/ui/BackButton"
import { useAuth } from "../context/AuthContext"
import Avatar from "../components/ui/Avatar"
import StatusPill from "../components/ui/StatusPill"
import EmptyState from "../components/ui/EmptyState"
import WorkingTimeProgress, { effectiveWorkingMinutes } from "../components/ui/WorkingTimeProgress"
import { formatTime } from "../utils/time"

// Buttons an admin can mark (LATE is set by the server's late rule).
const STATUS_CONFIG = {
  PRESENT: { label: "Present", tone: "green", icon: CheckCircle2 },
  ABSENT: { label: "Absent", tone: "pink", icon: XCircle },
  LEAVE: { label: "Leave", tone: "yellow", icon: Palmtree },
}
const LATE_CONFIG = { label: "Late", tone: "yellow" }

function statusPill(status) {
  const cfg = STATUS_CONFIG[status] || (status === "LATE" ? LATE_CONFIG : { label: status, tone: "slate" })
  return <StatusPill tone={cfg.tone}>{cfg.label}</StatusPill>
}

/* ------------------------------------------------------------------------
   Summary metrics + filters. Every summary number is the count of one of
   these filters, so clicking a number filters the table to exactly those
   rows. ctx = { scheduled, isPast, isFuture } for that day.
   "absent" matches the dashboard snapshot's rule (no one on a future day,
   only explicitly marked absences on a non-working day); "noclockin" is the
   subset of absent employees with no attendance record at all.
------------------------------------------------------------------------ */
const attended = (r) => r.status === "PRESENT" || r.status === "LATE"
const FILTERS = {
  ontime: { label: "On time", match: (r) => r.status === "PRESENT", good: true },
  late: { label: "Late clock-in", match: (r) => r.status === "LATE" },
  early: { label: "Early clock-in", match: (r) => attended(r) && r.arrivalOffsetMinutes != null && r.arrivalOffsetMinutes < 0, good: true },
  absent: { label: "Absent", match: (r, c) => r.status === "ABSENT" && !c.isFuture && (c.scheduled || !!r.recordId) },
  noclockin: { label: "No clock-in", match: (r, c) => r.status === "ABSENT" && !r.recordId && !c.isFuture && c.scheduled },
  noclockout: { label: "No clock-out", match: (r, c) => !!r.checkInAt && !r.checkOutAt && c.isPast },
  dayoff: { label: "Day off", match: (r, c) => !c.scheduled && !r.recordId },
  timeoff: { label: "Time off", match: (r) => r.status === "LEAVE" },
  // Not a summary tile — kept for the dashboard's "Present" deep link.
  present: { label: "Present", match: attended },
  // Not summary tiles — the CEO dashboard Company overview deep links
  // (explicit ABSENT record / no record at all, any day).
  markedabsent: { label: "Marked absent", match: (r) => r.status === "ABSENT" && !!r.recordId },
  notmarked: { label: "Not marked", match: (r) => !r.recordId },
  // Advance Filter only (attendance engine results / who marked it).
  halfday: { label: "Half day", match: (r) => attended(r) && r.dayType === "HALF_DAY" },
  earlygoing: { label: "Early going", match: (r) => attended(r) && r.dayType === "EARLY_GOING" },
  siteadmin: { label: "Marked by Site Admin", match: (r) => r.markedByRole === "SITE_ADMIN" },
}

const SUMMARIES = [
  { title: "Present Summary", icon: ClipboardCheck, tone: "text-chip-green-fg", keys: ["ontime", "late", "early"] },
  { title: "Not Present Summary", icon: ClipboardX, tone: "text-chip-pink-fg", keys: ["absent", "noclockin", "noclockout"] },
  { title: "Away Summary", icon: CalendarOff, tone: "text-chip-blue-fg", keys: ["dayoff", "timeoff"] },
]

// Literal class names so Tailwind picks them up.
const METRIC_COLS = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" }

/* Dates are YYYY-MM-DD keys (what GET /attendance takes), stepped in UTC. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function todayKeyIn(timeZone) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined }).format(new Date()) }
  catch { return new Intl.DateTimeFormat("en-CA").format(new Date()) }
}
function addDays(key, n) {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const longDateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" })

function formatDuration(minutes) {
  if (minutes == null) return "—"
  const m = Math.max(0, Math.round(minutes))
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}

function mapsLink(lat, lng) {
  return `https://www.google.com/maps?q=${lat},${lng}`
}

// Where the attendance was recorded:
//   biometric punch            → "On site · <device>"
//   check-in inside a site     → "On site · <site name>" (links to the spot)
//   check-in inside the office → "On site · Office"
//   check-in outside premises  → red "Outside premises · Xm" (links to the
//                                exact spot so HR can review it)
function LocationFlag({ row }) {
  const hasLocation = row.latitude != null && row.longitude != null
  const plain = (Icon, text, tone = "text-muted-2") => (
    <span className={`inline-flex max-w-[200px] items-center gap-1 text-xs ${tone}`}>
      <Icon size={12} className="shrink-0" /> <span className="truncate">{text}</span>
    </span>
  )

  if (row.source === "BIOMETRIC") {
    return plain(Fingerprint, `On site · ${row.deviceName || "Biometric device"}`, "font-medium text-chip-green-fg")
  }
  if (!row.checkInAt) return <span className="text-xs text-muted-2">—</span>
  if (row.locationMode === "WFH") return plain(Home, "Working from home")
  if (!hasLocation) return plain(MapPin, row.workLocationType === "FIELD" ? "Field · No location" : "No location recorded")

  const outside = row.autoFlagged
  const label = outside
    ? `Outside premises${row.distanceMeters != null ? ` · ${row.distanceMeters}m away` : ""}`
    : row.siteName ? `On site · ${row.siteName}`
    : row.distanceMeters != null ? "On site · Office"
    : "Location recorded"
  const onSite = !outside && label.startsWith("On site")
  return (
    <a
      href={mapsLink(row.latitude, row.longitude)}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex max-w-[200px] items-center gap-1 text-xs hover:underline ${outside ? "font-semibold text-chip-pink-fg" : onSite ? "font-medium text-chip-green-fg" : "text-accent"}`}
      title={`${Number(row.latitude).toFixed(6)}, ${Number(row.longitude).toFixed(6)} — open in Google Maps`}
    >
      {outside ? <AlertTriangle size={12} className="shrink-0" /> : <MapPin size={12} className="shrink-0" />}
      <span className="truncate">{label}</span>
    </a>
  )
}


function overtimeMinutes(row, date) {
  if (!row.checkOutAt) return null
  const worked = effectiveWorkingMinutes({ ...row, date })
  const over = worked - (Number(row.expectedWorkingMinutes) || 480)
  return over > 0 ? over : null
}

// Clock-in —— duration —— clock-out. Late clock-in and overtime clock-out
// are highlighted in amber.
function ClockInOut({ row, date, timeZone }) {
  if (!row.checkInAt) return <span className="text-xs text-muted-2">—</span>
  const worked = effectiveWorkingMinutes({ ...row, date })
  const late = row.status === "LATE"
  const overtime = overtimeMinutes(row, date) != null
  return (
    <div className="flex items-center gap-2 whitespace-nowrap text-[13px] font-semibold tabular-nums">
      <span className={late ? "text-[#D97706]" : "text-ink"}>{formatTime(row.checkInAt, { timeZone })}</span>
      <span className="flex min-w-[64px] flex-1 items-center gap-1 text-[10px] font-medium text-muted-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />
        <span className="h-px flex-1 bg-border-strong" />
        <span>{formatDuration(worked)}</span>
        <span className="h-px flex-1 bg-border-strong" />
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />
      </span>
      <span className={row.checkOutAt ? (overtime ? "text-[#D97706]" : "text-ink") : "text-xs font-medium text-muted-2"}>
        {row.checkOutAt ? formatTime(row.checkOutAt, { timeZone }) : "Still in"}
      </span>
    </div>
  )
}

// Closes a popover when clicking outside it or pressing Escape.
function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey) }
  }, [open])
  return { open, setOpen, ref }
}

// Popover anchored to a button with position:fixed, so it isn't clipped by
// the table's horizontal-scroll container. Closes on outside click, Escape,
// scroll or resize.
function useAnchoredPopover(width) {
  const [pos, setPos] = useState(null)
  const anchorRef = useRef(null)
  const panelRef = useRef(null)
  const open = !!pos
  function toggle() {
    if (pos) return setPos(null)
    const r = anchorRef.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
    const below = window.innerHeight - r.bottom > 260
    setPos(below ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 })
  }
  useEffect(() => {
    if (!open) return
    const close = () => setPos(null)
    const onDown = (e) => {
      if (!panelRef.current?.contains(e.target) && !anchorRef.current?.contains(e.target)) close()
    }
    const onKey = (e) => { if (e.key === "Escape") close() }
    const onScroll = (e) => { if (!panelRef.current?.contains(e.target)) close() }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", close)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", close)
    }
  }, [open])
  const panelStyle = pos ? { position: "fixed", width, zIndex: 40, ...pos } : undefined
  return { open, toggle, close: () => setPos(null), anchorRef, panelRef, panelStyle }
}

// One pill showing the current status; writers click it to pick another.
// The change is local until Save (same as before).
function StatusMenu({ row, canWrite, onMark }) {
  const pop = useAnchoredPopover(170)
  if (!canWrite) return statusPill(row.status)
  const current = STATUS_CONFIG[row.status] || (row.status === "LATE" ? LATE_CONFIG : { tone: "slate" })
  return (
    <>
      <button
        ref={pop.anchorRef}
        type="button"
        onClick={pop.toggle}
        aria-haspopup="menu"
        aria-expanded={pop.open}
        aria-label={`Status for ${row.name}: ${(current.label || row.status)}. Change status`}
        className="inline-flex items-center gap-1 rounded-full transition-opacity hover:opacity-80"
      >
        {statusPill(row.status)}
        <ChevronDown size={13} className="text-muted" />
      </button>
      {pop.open && createPortal(
        <div ref={pop.panelRef} style={pop.panelStyle} role="menu" className="rounded-2xl border border-border bg-surface p-1.5 shadow-pop">
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
            // A normal late arrival counts as "Present" here. A flagged one
            // (checked in outside the premises) doesn't, so HR can pick
            // Present to approve it.
            const active = row.status === key || (key === "PRESENT" && row.status === "LATE" && !row.autoFlagged)
            return (
              <button
                key={key}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => { if (!active) onMark(row.employeeId, key); pop.close() }}
                className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm ${active ? "bg-surface-2 font-semibold text-ink" : "text-ink hover:bg-surface-2"}`}
              >
                <cfg.icon size={14} className={`text-chip-${cfg.tone}-fg`} />
                <span className="flex-1">{cfg.label}</span>
                {active && <Check size={14} className="text-accent" />}
              </button>
            )
          })}
          {row.status === "LATE" && (
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] leading-4 text-muted">
              {row.autoFlagged
                ? "Checked in outside the premises. Present approves it (it stays Late only if the check-in time itself was late)."
                : "Late is set from the check-in time; marking Present keeps it Late."}
            </p>
          )}
        </div>,
        document.body
      )}
    </>
  )
}

const DAY_RESULT = {
  HALF_DAY: { label: "Half day", tone: "orange" },
  EARLY_GOING: { label: "Early going", tone: "pink" },
}

// Half day / early going result from the attendance engine, with the
// details behind it (scheduled start, actual check-in, late duration, early
// departure, deduction) in a popover.
function DayResult({ row, timeZone }) {
  const pop = useAnchoredPopover(280)
  const cfg = DAY_RESULT[row.dayType]
  if (!cfg) return null
  const fine = row.fine
  const lines = [
    ["Scheduled start", row.scheduledStartAt ? formatTime(row.scheduledStartAt, { timeZone }) : "—"],
    ["Actual check-in", row.checkInAt ? formatTime(row.checkInAt, { timeZone }) : "—"],
    ["Late by", row.lateDurationMinutes ? formatDuration(row.lateDurationMinutes) : "On time"],
    ...(row.checkOutAt ? [["Check-out", formatTime(row.checkOutAt, { timeZone })], ["Left early by", row.earlyGoingMinutes ? formatDuration(row.earlyGoingMinutes) : "—"]] : []),
    ["Deduction", `${row.deductionDays ?? 0.5} day${fine ? ` · ${pkr(fine.waived ? 0 : fine.autoAmount)}` : ""}`],
    ...(row.earlyGoingFineAmount ? [["Early-going fine", pkr(row.earlyGoingFineAmount)]] : []),
  ]
  return (
    <>
      <button ref={pop.anchorRef} type="button" onClick={pop.toggle} aria-expanded={pop.open} className="mt-1 inline-flex items-center gap-1 hover:opacity-80" title={row.dayTypeReason || cfg.label}>
        <StatusPill tone={cfg.tone}>{cfg.label}</StatusPill>
      </button>
      {pop.open && createPortal(
        <div ref={pop.panelRef} style={pop.panelStyle} className="rounded-2xl border border-border bg-surface p-3 text-xs shadow-pop">
          <p className="font-semibold text-ink">{cfg.label} — {row.name}</p>
          {row.dayTypeReason && <p className="mt-1 text-muted">{row.dayTypeReason}</p>}
          <dl className="mt-2 space-y-1">
            {lines.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="font-semibold text-ink">{v}</dd></div>
            ))}
          </dl>
          {fine?.waived && <p className="mt-2 text-[10px] text-chip-green-fg">The automatic deduction for this day is waived.</p>}
          {fine?.locked && <p className="mt-1 text-[10px] text-muted-2">This month's payslip is {fine.payslipStatus === "PAID" ? "paid" : "submitted"} — change it with a payroll adjustment.</p>}
          {!fine && <p className="mt-2 text-[10px] text-muted-2">Deduction amounts are visible to HR, Admin and CEO.</p>}
        </div>,
        document.body
      )}
    </>
  )
}

// "Marked by Ali · Site Admin · Lahore Site" for attendance a Site Admin marked.
function SiteAdminMark({ row }) {
  if (row.markedByRole !== "SITE_ADMIN") return null
  return (
    <p className="mb-1 text-[11px] text-chip-blue-fg">
      Marked by {row.markedByName} · Site Admin{row.siteName ? ` · ${row.siteName}` : ""}{row.checkOutSiteName ? ` → out at ${row.checkOutSiteName}` : ""}
    </p>
  )
}

const NOTE_MAX = 500

// The employee's own note / extra hours claimed (from My Attendance), and a
// marker when the system checked them out at shift end. HR/ADMIN/CEO can
// mark it seen (or undo) and delete it (PUT /attendance/employee-note).
function EmployeeNoteLine({ row, date, canReview, onChanged }) {
  const act = useMutation({
    mutationFn: (action) => api.put("/attendance/employee-note", { employeeId: row.employeeId, date, action }).then((r) => r.data),
    onSuccess: (res) => onChanged(row.employeeId, res),
  })
  if (!row.employeeNote && !row.extraMinutes && !row.autoCheckedOut) return null
  const extra = row.extraMinutes || 0
  const extraLabel = extra ? `+${Math.floor(extra / 60) ? `${Math.floor(extra / 60)}h ` : ""}${extra % 60 ? `${extra % 60}m` : ""}`.trim() : null
  const hasNote = !!(extraLabel || row.employeeNote)
  const seen = !!row.employeeNoteSeenAt
  return (
    <div className="mb-1.5 space-y-1 text-xs">
      {row.autoCheckedOut && <p className="text-[11px] text-muted-2">Auto check-out at shift end</p>}
      {hasNote && (
        <p className="line-clamp-3 text-ink" title={row.employeeNote || ""}>
          {!seen && canReview && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" title="New — not marked as seen" />}
          {extraLabel && <span className="mr-1.5 rounded-full bg-chip-blue-bg px-2 py-0.5 text-[10px] font-semibold text-chip-blue-fg">{extraLabel} extra</span>}
          {row.employeeNote && <span><span className="text-muted">Employee:</span> {row.employeeNote}</span>}
        </p>
      )}
      {hasNote && canReview && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {seen ? (
            <button type="button" disabled={act.isPending} onClick={() => act.mutate("unseen")} className="inline-flex items-center gap-1 font-semibold text-chip-green-fg hover:underline disabled:opacity-50" title="Click to mark as not seen">
              <Check size={11} /> Seen{row.employeeNoteSeenByName ? ` by ${row.employeeNoteSeenByName}` : ""}
            </button>
          ) : (
            <button type="button" disabled={act.isPending} onClick={() => act.mutate("seen")} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline disabled:opacity-50">
              <Check size={11} /> Mark seen
            </button>
          )}
          <button
            type="button"
            disabled={act.isPending}
            onClick={() => window.confirm(`Delete ${row.name}'s note${extraLabel ? " and extra-hours claim" : ""} for this day?`) && act.mutate("delete")}
            className="inline-flex items-center gap-1 font-semibold text-danger hover:underline disabled:opacity-50"
          >
            <Trash2 size={11} /> Delete
          </button>
          {act.isError && <span className="text-danger">{act.error?.response?.data?.error || "Couldn't update."}</span>}
        </div>
      )}
    </div>
  )
}

function pkr(n) {
  return `PKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

// The half-day / early-going rules (services/attendance-engine.js on the
// server), edited in the same panel as the fines: [key, label, unit, help].
const POLICY_FIELDS = [
  ["lateHalfDayThresholdHours", "Late-arrival half day", "hours late", "Arriving this many hours (or more) after the scheduled start makes the day a half day."],
  ["halfDayMinimumHours", "Minimum for a full day", "hours worked", "Working less than this (break counted as office time) makes the day a half day."],
  ["halfDayDeductionPercent", "Half-day deduction", "% of day rate", "How much of the day rate (the absent fine / day above) a half day deducts."],
  ["earlyGoingThresholdHours", "Very short day", "hours or less", "Working this little is recorded as Early going: half-day deduction plus the fine below."],
  ["earlyGoingFineAmount", "Early-going fine", "PKR", "Added on top of the half-day deduction for an Early-going day. 0 = no fine."],
]

// "Policy & fines" header panel (HR/ADMIN/CEO): the late and absent fine per
// day plus the half-day / early-going policy, for the whole organization
// (PUT /attendance/fine-settings). Payroll applies them; draft payslips are
// refreshed on save. Shows what today's rows add up to. Set any hours to 0
// to turn that rule off.
function FineSettings({ settings, lateCount, absentCount, halfDayCount, dayTotal, onSaved }) {
  const pop = usePopover()
  const [form, setForm] = useState({})
  const fromSettings = () => ({
    lateFine: String(settings.lateFine ?? ""),
    absentFine: settings.absentFine == null ? "" : String(settings.absentFine),
    ...Object.fromEntries(POLICY_FIELDS.map(([key]) => [key, settings[key] == null ? "" : String(settings[key])])),
  })
  const save = useMutation({
    mutationFn: () => api.put("/attendance/fine-settings", form).then((r) => r.data),
    onSuccess: (res) => onSaved(res),
  })
  function toggle() {
    if (!pop.open) {
      setForm(fromSettings())
      save.reset()
    }
    pop.setOpen((v) => !v)
  }
  const initial = fromSettings()
  const unchanged = Object.keys(initial).every((k) => String(form[k] ?? "") === initial[k])
  const dayRate = Number(form.absentFine) || 0
  const halfDayAmount = (dayRate * (Number(form.halfDayDeductionPercent) || 0)) / 100

  return (
    <div className="relative" ref={pop.ref}>
      <button type="button" onClick={toggle} className="pill-secondary flex items-center gap-1.5 px-4 py-2.5 text-sm" aria-expanded={pop.open} title="Fines and the half-day / early-going policy">
        <Wallet size={15} /> Policy &amp; fines
        {dayTotal > 0 && <span className="rounded-full bg-chip-pink-bg px-2 py-0.5 text-[10px] font-semibold text-chip-pink-fg">{pkr(dayTotal)}</span>}
      </button>
      {pop.open && (
        <form
          onSubmit={(e) => { e.preventDefault(); save.mutate() }}
          className="absolute right-0 z-30 mt-2 max-h-[80vh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-surface p-4 shadow-pop"
        >
          <p className="text-sm font-semibold text-ink">Attendance &amp; payroll policy</p>
          <p className="mt-0.5 text-xs text-muted">Deducted in payroll for late, absent, half and very short days.</p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-[11px] font-medium text-muted">
              Late fine / day
              <div className="relative mt-1">
                <input type="number" min="500" step="any" required value={form.lateFine} onChange={(e) => setForm((f) => ({ ...f, lateFine: e.target.value }))} className="field py-2 pr-10 text-xs" />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-2">PKR</span>
              </div>
            </label>
            <label className="text-[11px] font-medium text-muted">
              Absent fine / day
              <div className="relative mt-1">
                <input type="number" min="1000" step="any" value={form.absentFine} placeholder="Not set" onChange={(e) => setForm((f) => ({ ...f, absentFine: e.target.value }))} className="field py-2 pr-10 text-xs" />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-2">PKR</span>
              </div>
            </label>
          </div>
          <p className="mt-1.5 text-[10px] leading-4 text-muted-2">
            The absent fine is also charged per unpaid-leave day (half for a half day) and is the day rate the half-day deduction uses. Leave it empty for no absent fine.
          </p>

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Half day &amp; early going</p>
          <div className="mt-2 space-y-2.5">
            {POLICY_FIELDS.map(([key, label, unit, help]) => (
              <label key={key} className="block text-[11px] font-medium text-muted">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-ink">{label}</span>
                  <span className="relative w-32">
                    <input
                      type="number" min="0" step="any" required value={form[key] ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      className="field py-1.5 pr-14 text-right text-xs"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-2">{unit}</span>
                  </span>
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-muted-2">{help}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-[11px] text-muted">
            {dayRate > 0
              ? <>A half day deducts <span className="font-semibold text-ink">{pkr(halfDayAmount)}</span>{Number(form.earlyGoingFineAmount) > 0 && <> · an early-going day <span className="font-semibold text-ink">{pkr(halfDayAmount + Number(form.earlyGoingFineAmount))}</span></>}. A half day replaces that day's late fine. Hours set to 0 turn a rule off.</>
              : <>No absent fine / day is set, so half days are recorded but deduct nothing{Number(form.earlyGoingFineAmount) > 0 ? " (the early-going fine still applies)" : ""}.</>}
          </p>
          <p className="mt-1.5 text-[10px] leading-4 text-muted-2">Policy changes apply to attendance recorded from now on; days already recorded keep their result.</p>

          <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-xs text-ink">
            <p className="font-semibold">This day</p>
            <p className="mt-0.5 text-muted">
              {lateCount} late · {absentCount} absent · {halfDayCount} half / short — <span className="font-semibold text-chip-pink-fg">{pkr(dayTotal)}</span> in deductions
            </p>
          </div>

          {save.isError && <p className="mt-2 text-xs text-danger">{save.error?.response?.data?.error || "Couldn't save the fines."}</p>}
          {save.isSuccess && (
            <p className="mt-2 text-xs text-chip-green-fg">
              Saved{save.data.refreshedDrafts ? ` — ${save.data.refreshedDrafts} draft payslip${save.data.refreshedDrafts === 1 ? "" : "s"} updated` : ""}.
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => pop.setOpen(false)} className="pill-secondary px-3 py-1.5 text-xs">Close</button>
            <button type="submit" disabled={save.isPending || unchanged || form.lateFine === ""} className="pill-accent px-3 py-1.5 text-xs disabled:opacity-50">
              {save.isPending ? "Saving…" : "Save policy"}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-muted-2">Submitted or paid payslips keep the amounts they were issued with.</p>
        </form>
      )}
    </div>
  )
}

// Day note: read-only for everyone, editable by HR/ADMIN/CEO. Saved on its
// own (PUT /attendance/notes) — independent of the status Save button.
function NoteCell({ row, date, canEdit, onSaved }) {
  const pop = useAnchoredPopover(300)
  const [draft, setDraft] = useState("")
  const save = useMutation({
    mutationFn: (note) => api.put("/attendance/notes", { employeeId: row.employeeId, date, note }).then((r) => r.data),
    onSuccess: (res) => { onSaved(row.employeeId, res); pop.close() },
  })
  const meta = row.note && row.noteAuthorName ? `${row.noteAuthorName}${row.noteUpdatedAt ? ` · ${new Date(row.noteUpdatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}` : ""

  if (!canEdit) {
    return row.note
      ? <p className="line-clamp-2 text-xs text-ink" title={meta ? `${row.note}\n— ${meta}` : row.note}>{row.note}</p>
      : <span className="text-xs text-muted-2">-</span>
  }

  return (
    <>
      <button
        ref={pop.anchorRef}
        type="button"
        onClick={() => { if (!pop.open) { setDraft(row.note || ""); save.reset() } pop.toggle() }}
        className="group flex w-full max-w-[240px] items-start gap-1.5 rounded-lg px-1.5 py-1 text-left hover:bg-surface-2"
        title={row.note ? (meta ? `${row.note}\n— ${meta}` : row.note) : "Add a note"}
        aria-label={row.note ? `Edit note for ${row.name}` : `Add note for ${row.name}`}
      >
        {row.note
          ? <span className="line-clamp-2 flex-1 text-xs text-ink">{row.note}</span>
          : <span className="flex items-center gap-1 text-xs text-muted-2 group-hover:text-accent"><Plus size={12} /> Add note</span>}
        {row.note && <Pencil size={11} className="mt-0.5 shrink-0 text-muted-2 opacity-0 group-hover:opacity-100" />}
      </button>
      {pop.open && createPortal(
        <form
          ref={pop.panelRef}
          style={pop.panelStyle}
          onSubmit={(e) => { e.preventDefault(); save.mutate(draft) }}
          className="rounded-2xl border border-border bg-surface p-3 shadow-pop"
        >
          <p className="text-xs font-semibold text-ink">Note for {row.name}</p>
          {meta && <p className="mt-0.5 text-[10px] text-muted">Last edited by {meta}</p>}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))}
            rows={4}
            autoFocus
            placeholder="e.g. Doctor's appointment in the morning"
            className="field mt-2 resize-none text-xs"
            aria-label="Note"
          />
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-2">
            <span>{draft.length}/{NOTE_MAX}</span>
            {save.isError && <span className="text-danger">{save.error?.response?.data?.error || "Couldn't save."}</span>}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            {row.note
              ? <button type="button" onClick={() => save.mutate("")} disabled={save.isPending} className="text-xs font-semibold text-danger disabled:opacity-50">Remove</button>
              : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={pop.close} className="pill-secondary px-3 py-1.5 text-xs">Cancel</button>
              <button type="submit" disabled={save.isPending || draft.trim() === (row.note || "")} className="pill-accent px-3 py-1.5 text-xs disabled:opacity-50">
                {save.isPending ? "Saving…" : "Save note"}
              </button>
            </div>
          </div>
        </form>,
        document.body
      )}
    </>
  )
}

const VIEW_KEY = "assetflow_attendance_view"
function readView() {
  try { return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list" } catch { return "list" }
}

export default function Attendance() {
  const { user, organization } = useAuth()
  const queryClient = useQueryClient()

  const { data: permission, isLoading: permissionLoading } = useQuery({
    queryKey: ["attendance-permission-me"],
    queryFn: () => api.get("/organization/attendance-permissions/me").then((r) => r.data),
  })
  const hasAccess = !!permission?.canRead
  const canWrite = !!(permission?.canCreate || permission?.canUpdate)
  const canResolve = !!permission?.canUpdate

  // URL state: ?date=YYYY-MM-DD, ?status=<FILTERS key>, ?dept=<name>. The
  // dashboard snapshot deep-links with date + status=present|late|absent.
  const [searchParams, setSearchParams] = useSearchParams()
  const todayKey = todayKeyIn(organization?.timezone)
  const dateParam = searchParams.get("date")
  const date = dateParam && DATE_RE.test(dateParam) ? dateParam : todayKey
  const statusFilter = FILTERS[searchParams.get("status")] ? searchParams.get("status") : null
  const deptFilter = searchParams.get("dept") || ""

  function setParams(changes) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v)
        else next.delete(k)
      }
      return next
    }, { replace: true })
  }

  const [rows, setRows] = useState([])
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState({ key: "name", dir: "asc" })
  const [view, setView] = useState(readView)
  const [exportRange, setExportRange] = useState(() => ({ startDate: date, endDate: date }))
  const [exportError, setExportError] = useState("")
  const report = usePopover()
  const filterPop = usePopover()
  const dateInputRef = useRef(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["attendance", date],
    queryFn: () => api.get("/attendance", { params: { date } }).then((r) => r.data),
    enabled: hasAccess,
  })
  const prevDate = addDays(date, -1)
  const { data: prevData } = useQuery({
    queryKey: ["attendance", prevDate],
    queryFn: () => api.get("/attendance", { params: { date: prevDate } }).then((r) => r.data),
    enabled: hasAccess,
  })

  // Unsaved status changes, by employee. A refetch (window focus, a saved
  // note) re-applies them on top of the fresh rows instead of wiping them.
  const editsRef = useRef(new Map())

  useEffect(() => {
    if (!data?.rows) return
    const edits = editsRef.current
    setRows(data.rows.map((r) => (edits.has(r.employeeId) ? { ...r, ...edits.get(r.employeeId) } : r)))
    setDirty(edits.size > 0)
  }, [data])

  // Switching days: drop the previous day's rows and edits instead of
  // showing them under the new date while it loads.
  useEffect(() => {
    editsRef.current = new Map()
    setRows(data?.rows || [])
    setDirty(false)
  }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view) } catch { /* per-viewer convenience only */ }
  }, [view])

  function goToDate(key) {
    if (!key || !DATE_RE.test(key) || key === date) return
    if (dirty && !window.confirm("You have unsaved attendance changes for this day. Discard them?")) return
    setSaved(false)
    setExportRange({ startDate: key, endDate: key })
    setParams({ date: key === todayKey ? null : key })
  }

  function setLocalStatus(employeeId, status) {
    const patch = { status, time: new Date().toISOString(), markedByName: user?.name, markedById: user?.id }
    editsRef.current.set(employeeId, patch)
    setRows((prev) => prev.map((r) => (r.employeeId === employeeId ? { ...r, ...patch } : r)))
    setDirty(true); setSaved(false)
  }

  // Note saved server-side: patch the cached day so it survives a refetch
  // (pending status edits are re-applied by the effect above).
  function onNoteSaved(employeeId, res) {
    const apply = (r) => (r.employeeId === employeeId
      ? { ...r, note: res.note, noteAuthorName: res.noteAuthorName, noteUpdatedAt: res.noteUpdatedAt }
      : r)
    queryClient.setQueryData(["attendance", date], (old) => (old ? { ...old, rows: old.rows.map(apply) } : old))
  }

  const canNote = ["ADMIN", "CEO", "HR"].includes(user?.role)
  // Fine settings/amounts come back only for HR/ADMIN/CEO (salary-derived).
  const fineSettings = canNote ? data?.fineSettings : null

  function onEmployeeNoteChanged(employeeId, res) {
    const apply = (r) => (r.employeeId === employeeId
      ? { ...r, employeeNote: res.employeeNote, extraMinutes: res.extraMinutes, employeeNoteSeenAt: res.employeeNoteSeenAt, employeeNoteSeenByName: res.employeeNoteSeenByName }
      : r)
    queryClient.setQueryData(["attendance", date], (old) => (old ? { ...old, rows: old.rows.map(apply) } : old))
  }
  function onFineSaved() {
    queryClient.invalidateQueries({ queryKey: ["attendance", date] })
    queryClient.invalidateQueries({ queryKey: ["payroll"] })
    queryClient.invalidateQueries({ queryKey: ["payroll-preview"] })
  }

  function invalidateDay() {
    queryClient.invalidateQueries({ queryKey: ["attendance", date] })
    queryClient.invalidateQueries({ queryKey: ["dashboard-attendance-snapshot"] })
  }

  const saveDay = useMutation({
    mutationFn: () =>
      // Only the rows actually changed — re-sending every row would stamp
      // "marked by" on everyone and clear their outside-premises flags.
      api.post("/attendance/save", {
        date,
        records: [...editsRef.current].map(([employeeId, patch]) => ({ employeeId, status: patch.status })),
      }),
    onSuccess: () => {
      editsRef.current = new Map(); setDirty(false); setSaved(true); invalidateDay()
      // Status changes move late/absent fines on draft payslips.
      queryClient.invalidateQueries({ queryKey: ["payroll"] })
    },
  })

  const exportSheet = useMutation({
    mutationFn: async () => {
      const { startDate, endDate } = exportRange
      const res = await api.get("/attendance/export", { params: { startDate, endDate }, responseType: "blob" })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement("a")
      link.href = url
      link.setAttribute("download", `Attendance_${startDate === endDate ? startDate : `${startDate}_to_${endDate}`}.xlsx`)
      document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => window.URL.revokeObjectURL(url), 1000)
    },
    onMutate: () => setExportError(""),
    onSuccess: () => report.setOpen(false),
    onError: () => setExportError("Couldn't generate the report. Check the date range and try again."),
  })

  const { data: anomalies = [] } = useQuery({
    queryKey: ["attendance-anomalies"],
    queryFn: () => api.get("/attendance/anomalies?limit=20").then((r) => r.data),
    enabled: hasAccess,
    refetchInterval: 30000,
  })

  const resolveAnomaly = useMutation({
    mutationFn: (id) => api.patch(`/attendance/anomalies/${id}/resolve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance-anomalies"] }),
  })

  // Correction requests employees sent from My Attendance. Approving writes
  // the corrected times onto that day's record (payroll reads the same
  // records), so it's an update permission, like marking.
  const { data: corrections = [] } = useQuery({
    queryKey: ["attendance-corrections", "PENDING"],
    queryFn: () => api.get("/attendance/corrections", { params: { status: "PENDING" } }).then((r) => r.data),
    enabled: hasAccess,
    refetchInterval: 60000,
  })
  const reviewCorrection = useMutation({
    mutationFn: ({ id, decision, note }) => api.patch(`/attendance/corrections/${id}`, { decision, note }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance-corrections"] })
      queryClient.invalidateQueries({ queryKey: ["attendance"] })
    },
  })
  function decideCorrection(c, decision) {
    let note = ""
    if (decision === "REJECTED") {
      note = window.prompt(`Reason for rejecting ${c.employeeName}'s correction (optional):`, "")
      if (note === null) return
    }
    reviewCorrection.mutate({ id: c.id, decision, note })
  }

  const timeZone = data?.schedule?.timezone || organization?.timezone
  const ctxFor = (d, key) => ({
    scheduled: d?.schedule?.isScheduledWorkday !== false,
    isPast: key < todayKey,
    isFuture: key > todayKey,
  })
  const ctx = ctxFor(data, date)

  const counts = useMemo(() => {
    const out = {}
    for (const k of Object.keys(FILTERS)) out[k] = rows.filter((r) => FILTERS[k].match(r, ctx)).length
    return out
  }, [rows, ctx.scheduled, ctx.isPast, ctx.isFuture]) // eslint-disable-line react-hooks/exhaustive-deps

  const prevCounts = useMemo(() => {
    if (!prevData?.rows) return null
    const c = ctxFor(prevData, prevDate)
    const out = {}
    for (const k of Object.keys(FILTERS)) out[k] = prevData.rows.filter((r) => FILTERS[k].match(r, c)).length
    return out
  }, [prevData, prevDate, todayKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const dayFineTotal = useMemo(() => rows.reduce((s, r) => s + (r.fine?.total || 0), 0), [rows])

  const departments = useMemo(
    () => [...new Set(rows.map((r) => r.department).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows]
  )

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = rows.filter((r) =>
      (!statusFilter || FILTERS[statusFilter].match(r, ctx)) &&
      (!deptFilter || r.department === deptFilter) &&
      (!q || r.name.toLowerCase().includes(q) || (r.department || "").toLowerCase().includes(q))
    )
    const val = (r) => {
      switch (sort.key) {
        case "clock": return r.checkInAt || "￿"
        case "worked": return effectiveWorkingMinutes({ ...r, date }) ?? -1
        case "status": return r.status
        default: return r.name.toLowerCase()
      }
    }
    const dir = sort.dir === "asc" ? 1 : -1
    return filtered.sort((a, b) => {
      const va = val(a), vb = val(b)
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir || a.name.localeCompare(b.name)
    })
  }, [rows, statusFilter, deptFilter, search, sort, date, ctx.scheduled, ctx.isPast, ctx.isFuture]) // eslint-disable-line react-hooks/exhaustive-deps

  if (permissionLoading) return <p className="text-sm text-muted">Loading...</p>

  if (!hasAccess) {
    return (
      <EmptyState
        title="Attendance is admin-only"
        description="Contact an org admin if you need access to manage attendance."
      />
    )
  }

  const isToday = date === todayKey
  const compareLabel = isToday ? "vs yesterday" : "vs previous day"
  const activeFilterCount = (statusFilter ? 1 : 0) + (deptFilter ? 1 : 0)

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }))
  }

  function SortHeader({ label, icon: Icon, sortKey }) {
    const active = sort.key === sortKey
    const DirIcon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown
    return (
      <th className="px-4 py-3" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        {sortKey ? (
          <button type="button" onClick={() => toggleSort(sortKey)} className="flex w-full items-center justify-between gap-2 font-semibold hover:text-ink">
            <span className="flex items-center gap-1.5"><Icon size={13} /> {label}</span>
            <DirIcon size={12} className={active ? "text-ink" : "text-muted-2"} />
          </button>
        ) : (
          <span className="flex items-center gap-1.5"><Icon size={13} /> {label}</span>
        )}
      </th>
    )
  }

  return (
    <div className="min-w-0">
      {/* ── Header: title + day navigator | report + add ── */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <BackButton />
          <h1 className="text-2xl font-semibold text-ink sm:text-[26px]" style={{ letterSpacing: "-0.02em" }}>Attendance</h1>
          <span className="hidden h-7 w-px bg-border-strong sm:block" aria-hidden="true" />
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => goToDate(addDays(date, -1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:bg-surface-2 hover:text-ink" aria-label="Previous day">
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => { try { dateInputRef.current?.showPicker() } catch { dateInputRef.current?.focus() } }}
              className="relative flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-ink hover:bg-surface-2"
              title="Pick a date"
            >
              {longDateFmt.format(new Date(`${date}T00:00:00Z`))}
              <CalendarDays size={14} className="text-muted" />
              <input
                ref={dateInputRef}
                type="date"
                value={date}
                onChange={(e) => goToDate(e.target.value)}
                className="pointer-events-none absolute inset-0 opacity-0"
                tabIndex={-1}
                aria-label="Attendance date"
              />
            </button>
            <button type="button" onClick={() => goToDate(addDays(date, 1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:bg-surface-2 hover:text-ink" aria-label="Next day">
              <ChevronRight size={15} />
            </button>
            {!isToday && (
              <button type="button" onClick={() => goToDate(todayKey)} className="ml-1 rounded-lg px-2 py-1 text-xs font-semibold text-accent hover:bg-surface-2">
                Today
              </button>
            )}
          </div>
          {dirty && <span className="rounded-full bg-chip-yellow-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-chip-yellow-fg">Unsaved</span>}
          {saved && !dirty && <span className="rounded-full bg-chip-green-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-chip-green-fg">Saved</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {fineSettings && (
            <FineSettings
              settings={fineSettings}
              lateCount={rows.filter((r) => r.fine?.autoType === "LATE").length}
              absentCount={rows.filter((r) => r.fine?.autoType === "ABSENT").length}
              halfDayCount={rows.filter((r) => r.fine?.autoType === "HALF_DAY" || r.fine?.autoType === "EARLY_GOING").length}
              dayTotal={dayFineTotal}
              onSaved={onFineSaved}
            />
          )}
          <div className="relative" ref={report.ref}>
            <button type="button" onClick={() => report.setOpen((v) => !v)} className="pill-secondary flex items-center gap-1.5 px-4 py-2.5 text-sm" aria-expanded={report.open}>
              <FileBarChart size={15} /> Attendance Report
            </button>
            {report.open && (
              <div className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-border bg-surface p-4 shadow-pop">
                <p className="text-sm font-semibold text-ink">Export attendance</p>
                <p className="mt-0.5 text-xs text-muted">Excel sheet for a date range.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="text-[11px] font-medium text-muted">
                    From
                    <input type="date" value={exportRange.startDate} max={exportRange.endDate} onChange={(e) => setExportRange((r) => ({ ...r, startDate: e.target.value }))} className="field mt-1 px-2 py-2 text-xs" />
                  </label>
                  <label className="text-[11px] font-medium text-muted">
                    To
                    <input type="date" value={exportRange.endDate} min={exportRange.startDate} onChange={(e) => setExportRange((r) => ({ ...r, endDate: e.target.value }))} className="field mt-1 px-2 py-2 text-xs" />
                  </label>
                </div>
                {exportError && <p className="mt-2 text-xs text-danger">{exportError}</p>}
                <button
                  type="button"
                  onClick={() => exportSheet.mutate()}
                  disabled={!exportRange.startDate || !exportRange.endDate || exportSheet.isPending}
                  className="pill-accent mt-3 flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-sm disabled:opacity-50"
                >
                  <Download size={14} /> {exportSheet.isPending ? "Preparing…" : "Download .xlsx"}
                </button>
              </div>
            )}
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={() => saveDay.mutate()}
              disabled={!dirty || saveDay.isPending}
              className="pill-accent flex items-center gap-1.5 px-4 py-2.5 text-sm disabled:opacity-40"
              title={dirty ? "Save status changes" : "No unsaved status changes"}
            >
              <Save size={15} /> {saveDay.isPending ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>

      {saveDay.isError && <div className="mb-4 rounded-2xl bg-chip-pink-bg px-4 py-2.5 text-sm text-chip-pink-fg">Couldn't save attendance: {saveDay.error?.response?.data?.error || "please try again."}</div>}
      {isError && <div className="mb-4 rounded-2xl bg-chip-pink-bg px-4 py-2.5 text-sm text-chip-pink-fg">Couldn't load attendance for this day.</div>}

      {/* ── Summary cards (each number filters the table) ── */}
      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-[3fr_3fr_2fr]">
        {SUMMARIES.map((s) => (
          <div key={s.title} className="card min-w-0 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <s.icon size={16} className={s.tone} /> {s.title}
            </p>
            <div className={`mt-3 grid grid-cols-2 gap-y-3 ${METRIC_COLS[s.keys.length]}`}>
              {s.keys.map((k, i) => {
                const f = FILTERS[k]
                const delta = prevCounts ? counts[k] - prevCounts[k] : null
                // Up is good for on-time/early, bad for everything else.
                const tone = !delta ? "text-muted-2" : (delta > 0) === !!f.good ? "text-chip-green-fg" : "text-danger"
                const active = statusFilter === k
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setParams({ status: active ? null : k })}
                    aria-pressed={active}
                    title={active ? "Show everyone" : `Show ${f.label.toLowerCase()}`}
                    className={`min-w-0 rounded-xl px-2.5 py-1.5 text-left transition-colors ${i > 0 ? "sm:border-l sm:border-border sm:rounded-l-none" : ""} ${active ? "bg-accent-soft" : "hover:bg-surface-2"}`}
                  >
                    <p className={`truncate text-xs ${active ? "font-semibold text-accent-ink" : "text-muted"}`}>{f.label}</p>
                    <p className="mt-0.5 text-2xl font-semibold leading-tight text-ink">{isLoading ? "—" : counts[k]}</p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-2">
                      {delta == null ? " " : (
                        <><span className={`font-semibold ${tone}`}>{delta > 0 ? `+ ${delta}` : delta < 0 ? `− ${Math.abs(delta)}` : "0"}</span> {compareLabel}</>
                      )}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── Correction requests awaiting approval ── */}
      {corrections.length === 0 && (
        <div className="mb-5 card flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <span>
            <span className="flex items-center gap-2 text-sm font-semibold text-ink"><Clock size={16} /> Correction requests</span>
            <span className="mt-0.5 block text-xs text-muted">
              Nothing waiting. Employees send these from My Attendance ("Request time correction") when a check-in or check-out is wrong they appear here for approval.
            </span>
          </span>
          <span className="rounded-full bg-chip-green-bg px-2.5 py-1 text-[10px] font-semibold text-chip-green-fg">0 waiting</span>
        </div>
      )}
      {corrections.length > 0 && (
        <details className="mb-5 card overflow-hidden" open>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <span>
              <span className="flex items-center gap-2 text-sm font-semibold text-ink"><Clock size={16} /> Correction requests</span>
              <span className="mt-0.5 block text-xs text-muted">
                Employees asking to fix a check-in or check-out. Approving updates that day's record — payroll uses it on the next Generate.
              </span>
            </span>
            <span className="rounded-full bg-chip-yellow-bg px-2.5 py-1 text-[10px] font-semibold text-chip-yellow-fg">{corrections.length} waiting</span>
          </summary>
          {reviewCorrection.isError && (
            <p className="border-b border-border bg-chip-pink-bg px-5 py-2 text-xs text-chip-pink-fg">
              {reviewCorrection.error?.response?.data?.error || "Couldn't save the decision — please try again."}
            </p>
          )}
          <div className="divide-y divide-border">
            {corrections.slice(0, 10).map((c) => {
              const dayKey = c.date ? String(c.date).slice(0, 10) : null
              const anchor = c.requestedCheckInAt || c.requestedCheckOutAt
              const dayLabel = dayKey
                ? longDateFmt.format(new Date(`${dayKey}T00:00:00Z`))
                : anchor ? new Date(anchor).toLocaleDateString("en-US", { timeZone, weekday: "long", day: "numeric", month: "long" }) : "—"
              const busy = reviewCorrection.isPending && reviewCorrection.variables?.id === c.id
              return (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      <Link to={`/employees/${c.employeeId}`} className="hover:underline">{c.employeeName}</Link>
                      <span className="font-normal text-muted"> · {dayLabel}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {c.requestedCheckInAt && <>In <span className="font-medium text-ink">{formatTime(c.requestedCheckInAt, { timeZone })}</span>{c.checkInAt ? ` (was ${formatTime(c.checkInAt, { timeZone })})` : ""}</>}
                      {c.requestedCheckInAt && c.requestedCheckOutAt && " · "}
                      {c.requestedCheckOutAt && <>Out <span className="font-medium text-ink">{formatTime(c.requestedCheckOutAt, { timeZone })}</span>{c.checkOutAt ? ` (was ${formatTime(c.checkOutAt, { timeZone })})` : ""}</>}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-2">“{c.reason}”</p>
                    {c.requestedByName && <p className="mt-0.5 text-[11px] text-chip-blue-fg">Requested by {c.requestedByName}{c.requestedByRole === "SITE_ADMIN" ? " (Site Admin)" : ""}</p>}
                  </div>
                  {canResolve && c.employeeId !== user?.id && c.requestedById !== user?.id ? (
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={busy} onClick={() => decideCorrection(c, "APPROVED")} className="pill-accent flex items-center gap-1 px-3 py-1.5 text-xs disabled:opacity-50">
                        <Check size={12} /> Approve
                      </button>
                      <button type="button" disabled={busy} onClick={() => decideCorrection(c, "REJECTED")} className="pill-secondary flex items-center gap-1 px-3 py-1.5 text-xs disabled:opacity-50">
                        <X size={12} /> Reject
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-2">{c.employeeId === user?.id || c.requestedById === user?.id ? "Your own request" : "View only"}</span>
                  )}
                </div>
              )
            })}
          </div>
        </details>
      )}

      {/* ── Anomalies needing review (unchanged behavior) ── */}
      {anomalies.length > 0 && (
        <details className="mb-5 card overflow-hidden" open>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <span>
              <span className="flex items-center gap-2 text-sm font-semibold text-ink"><ShieldAlert size={16} /> Attendance anomalies</span>
              <span className="mt-0.5 block text-xs text-muted">Location, device and attendance events requiring review.</span>
            </span>
            <span className="rounded-full bg-chip-pink-bg px-2.5 py-1 text-[10px] font-semibold text-chip-pink-fg">{anomalies.length} open</span>
          </summary>
          <div className="divide-y divide-border">
            {anomalies.slice(0, 8).map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{a.employeeName || "Employee"} · {a.type}</p>
                  <p className="mt-0.5 text-xs text-muted">{a.message}{a.siteName ? ` · ${a.siteName}` : ""}</p>
                </div>
                {canResolve && (
                  <button onClick={() => resolveAnomaly.mutate(a.id)} className="pill-secondary px-3 py-1.5 text-xs">Resolve</button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Toolbar: search, filters, view toggle ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* Icon is a flex sibling of the input (not absolutely positioned
            over it), so it can never overlap the placeholder. */}
        <label className="flex h-9 w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm focus-within:border-accent sm:w-60" style={{ maxWidth: 260 }}>
          <Search size={14} className="shrink-0 text-muted-2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted-2"
            aria-label="Search employee"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="shrink-0 text-muted-2 hover:text-ink" aria-label="Clear search">
              <X size={13} />
            </button>
          )}
        </label>

        <div className="relative" ref={filterPop.ref}>
          <button type="button" onClick={() => filterPop.setOpen((v) => !v)} aria-expanded={filterPop.open} className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2">
            <SlidersHorizontal size={14} /> Advance Filter
            {activeFilterCount > 0 && <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">{activeFilterCount}</span>}
          </button>
          {filterPop.open && (
            <div className="absolute left-0 z-30 mt-2 w-64 space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-pop">
              <label className="block text-[11px] font-medium text-muted">
                Status
                <select value={statusFilter || ""} onChange={(e) => setParams({ status: e.target.value || null })} className="field mt-1 py-2 text-sm">
                  <option value="">All statuses</option>
                  {Object.entries(FILTERS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
                </select>
              </label>
              <label className="block text-[11px] font-medium text-muted">
                Department
                <select value={deptFilter} onChange={(e) => setParams({ dept: e.target.value || null })} className="field mt-1 py-2 text-sm">
                  <option value="">All departments</option>
                  {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => { setParams({ status: null, dept: null }); filterPop.setOpen(false) }} disabled={!activeFilterCount} className="text-xs font-semibold text-accent disabled:opacity-40">
                Clear filters
              </button>
            </div>
          )}
        </div>

        {statusFilter && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent-ink">
            Showing: {FILTERS[statusFilter].label}{!isLoading && ` (${visibleRows.length})`}
            <button type="button" onClick={() => setParams({ status: null })} className="rounded-full p-0.5 hover:bg-black/5" aria-label="Show all employees"><X size={12} /></button>
          </span>
        )}
        {deptFilter && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent-ink">
            {deptFilter}
            <button type="button" onClick={() => setParams({ dept: null })} className="rounded-full p-0.5 hover:bg-black/5" aria-label="Clear department filter"><X size={12} /></button>
          </span>
        )}

        <div className="ml-auto flex rounded-xl border border-border bg-surface p-0.5" role="group" aria-label="View">
          {[["grid", LayoutGrid, "Grid view"], ["list", List, "List view"]].map(([v, Icon, label]) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} title={label} aria-label={label}
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${view === v ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}>
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="mb-3 text-sm text-muted">Loading...</p>}

      {/* ── Grid view (always used on phones) ── */}
      <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 ${view === "list" ? "md:hidden" : ""}`}>
        {visibleRows.map((row) => (
          <div key={row.employeeId} className="card min-w-0 p-4">
            <div className="flex items-center gap-3">
              <Avatar name={row.name} size="sm" />
              <div className="min-w-0 flex-1">
                <Link to={`/employees/${row.employeeId}`} className="block truncate text-sm font-semibold text-ink hover:text-accent hover:underline" title={`Open ${row.name}'s profile`}>{row.name}</Link>
                <p className="truncate text-xs text-muted">{row.department || "—"}</p>
              </div>
              <div className="flex flex-col items-end">
                <StatusMenu row={row} canWrite={canWrite} onMark={setLocalStatus} />
                <DayResult row={row} timeZone={timeZone} />
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <ClockInOut row={row} date={data?.date || date} timeZone={timeZone} />
              <WorkingTimeProgress workingMinutes={row.workingMinutes} checkInAt={row.checkInAt} checkOutAt={row.checkOutAt} expectedMinutes={row.expectedWorkingMinutes} date={data?.date || date} className="!max-w-none" />
              <LocationFlag row={row} />
              {(row.note || canNote || row.employeeNote || row.extraMinutes || row.markedByRole === "SITE_ADMIN") && (
                <div className="border-t border-border pt-2">
                  <SiteAdminMark row={row} />
                  <EmployeeNoteLine row={row} date={date} canReview={canNote} onChanged={onEmployeeNoteChanged} />
                  <NoteCell row={row} date={date} canEdit={canNote} onSaved={onNoteSaved} />
                </div>
              )}
            </div>
          </div>
        ))}
        {visibleRows.length === 0 && !isLoading && (
          <div className="sm:col-span-2 xl:col-span-3">
            <EmptyState title={rows.length ? "No employees match these filters" : "No active employees"} />
          </div>
        )}
      </div>

      {/* ── List (table) view ── */}
      {view === "list" && (
        <div className="hidden card overflow-hidden md:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b border-border bg-surface-2/60 text-left text-xs text-muted">
                <tr>
                  <SortHeader label="Employee Name" icon={User} sortKey="name" />
                  <SortHeader label="Clock-in & Out" icon={Clock} sortKey="clock" />
                  <SortHeader label="Working time" icon={Timer} sortKey="worked" />
                  <SortHeader label="Location" icon={MapPin} />
                  <SortHeader label="Note" icon={StickyNote} />
                  <SortHeader label="Status" icon={CheckCircle2} sortKey="status" />                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.employeeId} className="border-b border-border last:border-0 hover:bg-surface-2/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={row.name} size="xs" />
                        <div className="min-w-0">
                          <Link to={`/employees/${row.employeeId}`} className="block truncate font-semibold text-ink hover:text-accent hover:underline" title={`Open ${row.name}'s profile`}>{row.name}</Link>
                          <p className="truncate text-[11px] text-muted">{row.department || "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><ClockInOut row={row} date={data?.date || date} timeZone={timeZone} /></td>
                    <td className="px-4 py-3">
                      <WorkingTimeProgress workingMinutes={row.workingMinutes} checkInAt={row.checkInAt} checkOutAt={row.checkOutAt} expectedMinutes={row.expectedWorkingMinutes} date={data?.date || date} />
                    </td>
                    <td className="px-4 py-3"><LocationFlag row={row} /></td>
                    <td className="w-[250px] px-4 py-3">
                      <SiteAdminMark row={row} />
                      <EmployeeNoteLine row={row} date={date} canReview={canNote} onChanged={onEmployeeNoteChanged} />
                      <NoteCell row={row} date={date} canEdit={canNote} onSaved={onNoteSaved} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusMenu row={row} canWrite={canWrite} onMark={setLocalStatus} />
                      <div><DayResult row={row} timeZone={timeZone} /></div>
                    </td>                  </tr>
                ))}
                {visibleRows.length === 0 && !isLoading && (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-muted">{rows.length ? "No employees match these filters." : "No active employees."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
