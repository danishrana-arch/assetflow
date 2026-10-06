import { useMemo, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { CalendarDays, ChevronLeft, ChevronRight, Clock, UserCheck, Users, UserX } from "lucide-react"
import api from "../api/client"
import { formatTime } from "../utils/time"

/* Dates are handled as "YYYY-MM-DD" keys — the same shape GET /attendance
   takes — and stepped in UTC so DST changes never skip or repeat a day. */

function todayKeyIn(timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined }).format(new Date())
  } catch {
    return new Intl.DateTimeFormat("en-CA").format(new Date())
  }
}

function addDays(key, n) {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const asDate = (key) => new Date(`${key}T00:00:00Z`)
const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" })
const monthDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" })
const chipFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" })
const longFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" })

// Soft tinted tiles; light tints in light mode, faint glows in dark mode.
const TILE_TONES = {
  blue: {
    tile: "bg-chip-blue-bg/35 border-chip-blue-bg/80 dark:bg-chip-blue-tint/[0.06] dark:border-chip-blue-tint/10",
    icon: "bg-chip-blue-bg text-chip-blue-fg dark:bg-chip-blue-tint/15 dark:text-chip-blue-tint",
  },
  green: {
    tile: "bg-chip-green-bg/40 border-chip-green-bg dark:bg-chip-green-tint/[0.06] dark:border-chip-green-tint/10",
    icon: "bg-chip-green-bg text-chip-green-fg dark:bg-chip-green-tint/15 dark:text-chip-green-tint",
  },
  yellow: {
    tile: "bg-chip-yellow-bg/20 border-chip-yellow-bg/50 dark:bg-chip-yellow-tint/[0.06] dark:border-chip-yellow-tint/10",
    icon: "bg-chip-yellow-bg/80 text-chip-yellow-fg dark:bg-chip-yellow-tint/15 dark:text-chip-yellow-tint",
  },
  pink: {
    tile: "bg-chip-pink-bg/35 border-chip-pink-bg/80 dark:bg-chip-pink-tint/[0.06] dark:border-chip-pink-tint/10",
    icon: "bg-chip-pink-bg text-chip-pink-fg dark:bg-chip-pink-tint/15 dark:text-chip-pink-tint",
  },
}

function StatTile({ label, value, icon: Icon, tone, loading, to }) {
  const t = TILE_TONES[tone]
  return (
    // Icon on top, number at the bottom — fits four across in one row.
    <Link
      to={to}
      aria-label={`${label}: ${value}. Open details`}
      className={`flex min-h-[150px] min-w-0 flex-col rounded-2xl border p-4 transition-all hover:-translate-y-px hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:min-h-[200px] ${t.tile}`}
    >
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12 ${t.icon}`}>
        <Icon size={22} strokeWidth={1.9} />
      </div>
      <p className="mt-3 truncate text-sm font-medium text-muted">{label}</p>
      <p className={`mt-auto pt-2 text-3xl font-semibold leading-none text-ink transition-opacity sm:text-4xl ${loading ? "opacity-50" : ""}`}>
        {value}
      </p>
    </Link>
  )
}

const STATUS_PILL = {
  PRESENT: { label: "Present", dot: "bg-success", pill: "bg-chip-green-bg text-chip-green-fg dark:bg-chip-green-tint/15 dark:text-chip-green-tint" },
  LATE: { label: "Late", dot: "bg-[#E5A000]", pill: "bg-chip-yellow-bg/70 text-chip-yellow-fg dark:bg-chip-yellow-tint/15 dark:text-chip-yellow-tint" },
}

// "+12m", or "+1h 05m" once it passes an hour.
function formatLate(minutes) {
  if (minutes < 60) return `+${minutes}m`
  return `+${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

function AttendanceList({ rows, timeZone, isToday, isFuture, selected, loading }) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold text-ink">{isToday ? "Today Attendance" : "Attendance"}</p>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-ink">
          <CalendarDays size={12} className="text-accent" />
          {chipFmt.format(asDate(selected))}
        </span>
      </div>

      <ul className={`-mx-1 mt-3 max-h-[270px] min-h-0 flex-1 divide-y divide-border overflow-y-auto px-1 transition-opacity lg:max-h-none ${loading ? "opacity-50" : ""}`}>
        {rows.map((r) => {
          const cfg = STATUS_PILL[r.status]
          return (
            <li key={r.employeeId} className="flex items-center gap-2.5 py-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${cfg.dot}`} aria-hidden="true" />
              <Link to={`/employees/${r.employeeId}`} className="min-w-0 truncate text-[13px] font-medium text-ink hover:text-accent">
                {r.name}
              </Link>
              {r.status === "LATE" && r.lateMinutes > 0 && (
                <span className="shrink-0 text-[11px] font-semibold text-[#C98A00] dark:text-chip-yellow-tint">{formatLate(r.lateMinutes)}</span>
              )}
              <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">
                {r.checkInAt ? formatTime(r.checkInAt, { timeZone }) : "—"}
              </span>
              <span className={`w-[62px] shrink-0 rounded-full py-0.5 text-center text-[11px] font-semibold ${cfg.pill}`}>{cfg.label}</span>
            </li>
          )
        })}
        {rows.length === 0 && !loading && (
          <li className="py-6 text-center text-xs text-muted">
            {isFuture ? "This day hasn't started yet." : "No check-ins recorded for this day."}
          </li>
        )}
      </ul>
    </div>
  )
}

// `children` (the dashboard's Latest announcements) render under the stat
// tiles in the left column; the attendance list spans the full height.
export default function AttendanceSnapshot({ timeZone, children }) {
  const todayKey = todayKeyIn(timeZone)
  const [selected, setSelected] = useState(todayKey)
  // First visible day of the 7-day strip; opens starting at today.
  const [windowStart, setWindowStart] = useState(todayKey)
  const days = Array.from({ length: 7 }, (_, i) => addDays(windowStart, i))

  // Reuses the Attendance page's daily roster: every active employee with
  // their status for that date (no record → ABSENT).
  const { data, isFetching, isError } = useQuery({
    queryKey: ["dashboard-attendance-snapshot", selected],
    queryFn: () => api.get("/attendance", { params: { date: selected } }).then((r) => r.data),
    placeholderData: keepPreviousData,
  })
  // keepPreviousData shows the old date's rows while the new one loads; only
  // trust the data once it's for the selected date.
  const current = data?.date === selected ? data : null
  const loading = isFetching || !current

  const isFuture = selected > todayKey
  const isToday = selected === todayKey

  const { counts, arrivals } = useMemo(() => {
    const rows = data?.rows
    if (!rows) return { counts: null, arrivals: [] }
    const future = data.date > todayKey
    const scheduled = data?.schedule?.isScheduledWorkday !== false
    const attended = rows.filter((r) => r.status === "PRESENT" || r.status === "LATE")
    return {
      counts: {
        total: rows.length,
        // Same rule as Attendance.jsx's header: LATE still counts as present.
        present: attended.length,
        late: rows.filter((r) => r.status === "LATE").length,
        // Only people expected to work count as absent: nobody on a day that
        // hasn't happened yet, and on a non-working day only an explicitly
        // marked absence. Leave is never absent.
        absent: future ? 0 : rows.filter((r) => r.status === "ABSENT" && (scheduled || r.recordId)).length,
      },
      // Most recent arrival first; manual marks without a check-in time last.
      arrivals: [...attended].sort((a, b) => {
        if (!a.checkInAt) return 1
        if (!b.checkInAt) return -1
        return b.checkInAt.localeCompare(a.checkInAt)
      }),
    }
  }, [data, todayKey])

  const show = (n) => (counts ? n : "—")
  const arrowClass =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-ink sm:h-10 sm:w-10"

  return (
    <div className="p-4 sm:p-5 lg:p-6">
      {/* Heading + 7-day selector */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink sm:text-lg">Attendance Snapshot</p>
          <p className="mt-0.5 text-xs leading-5 text-muted sm:text-sm">Overview of attendance for your team</p>
        </div>

        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <button type="button" onClick={() => setWindowStart((s) => addDays(s, -1))} className={arrowClass} aria-label="Show previous day">
            <ChevronLeft size={16} />
          </button>

          <div className="flex min-w-0 gap-1.5 overflow-x-auto py-0.5" role="listbox" aria-label="Select a date">
            {days.map((key) => {
              const active = key === selected
              return (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={active}
                  title={longFmt.format(asDate(key))}
                  onClick={() => setSelected(key)}
                  className={`flex min-w-[54px] shrink-0 flex-col items-center rounded-xl border px-2 py-1.5 transition-colors sm:min-w-[62px] ${
                    active ? "border-transparent shadow-sm" : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-ink"
                  }`}
                  style={active ? { backgroundColor: "var(--accent)", color: "var(--surface)" } : undefined}
                >
                  <span className={`text-xs font-semibold leading-4 ${active ? "" : "text-ink"}`}>{weekdayFmt.format(asDate(key))}</span>
                  <span className={`text-[11px] leading-4 ${!active && key === todayKey ? "font-semibold text-accent" : ""}`}>
                    {monthDayFmt.format(asDate(key))}
                  </span>
                </button>
              )
            })}
          </div>

          <button type="button" onClick={() => setWindowStart((s) => addDays(s, 1))} className={arrowClass} aria-label="Show next day">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {isError && <p className="mt-3 text-xs text-danger">Couldn't load attendance for this date.</p>}

      {/* Stats (60%, four across) + attendance list (40%) */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-3">
        <div className="rounded-2xl border border-border p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Total Employees" value={show(counts?.total)} icon={Users} tone="blue" loading={loading} to="/employees" />
            <StatTile label="Present" value={show(counts?.present)} icon={UserCheck} tone="green" loading={loading} to={`/attendance?date=${selected}&status=present`} />
            <StatTile label={isToday ? "Late Today" : "Late"} value={show(counts?.late)} icon={Clock} tone="yellow" loading={loading} to={`/attendance?date=${selected}&status=late`} />
            <StatTile label={isToday ? "Absent Today" : "Absent"} value={show(counts?.absent)} icon={UserX} tone="pink" loading={loading} to={`/attendance?date=${selected}&status=absent`} />
          </div>
        </div>
        {children}
        </div>

        {/* On desktop the list is pinned to the left column's height (tiles +
            announcements) and scrolls inside. */}
        <div className="relative min-h-0 lg:col-span-2">
          <div className="lg:absolute lg:inset-0">
            <AttendanceList
              rows={current ? arrivals : []}
              timeZone={data?.schedule?.timezone || timeZone}
              isToday={isToday}
              isFuture={isFuture}
              selected={selected}
              loading={loading}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
