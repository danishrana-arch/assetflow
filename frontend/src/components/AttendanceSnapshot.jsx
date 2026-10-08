import { useEffect, useMemo, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { TotalEmployeesIcon, PresentIcon, LateIcon, AbsentIcon } from "./ui/StatusIcons"
import InteractiveMetricWorkspace, { MetricNav } from "./ui/InteractiveMetricWorkspace"
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

function useIsWide() {
  const query = "(min-width: 768px)"
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setWide(mq.matches)
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return wide
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
          <CalendarDays size={12} className="text-ink" />
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

  const { counts, arrivals, lists } = useMemo(() => {
    const rows = data?.rows
    if (!rows) return { counts: null, arrivals: [], lists: {} }
    const future = data.date > todayKey
    const scheduled = data?.schedule?.isScheduledWorkday !== false
    const attended = rows.filter((r) => r.status === "PRESENT" || r.status === "LATE")
    const lateRows = rows.filter((r) => r.status === "LATE")
    // Only people expected to work count as absent: nobody on a day that
    // hasn't happened yet, and on a non-working day only an explicitly
    // marked absence. Leave is never absent.
    const absentRows = future ? [] : rows.filter((r) => r.status === "ABSENT" && (scheduled || r.recordId))
    const byName = (a, b) => (a.name || "").localeCompare(b.name || "")
    return {
      lists: {
        total: [...rows].sort(byName),
        present: [...attended].sort(byName),
        late: [...lateRows].sort(byName),
        absent: [...absentRows].sort(byName),
      },
      counts: {
        total: rows.length,
        // Same rule as Attendance.jsx's header: LATE still counts as present.
        present: attended.length,
        late: lateRows.length,
        absent: absentRows.length,
      },
      // Most recent arrival first; manual marks without a check-in time last.
      arrivals: [...attended].sort((a, b) => {
        if (!a.checkInAt) return 1
        if (!b.checkInAt) return -1
        return b.checkInAt.localeCompare(a.checkInAt)
      }),
    }
  }, [data, todayKey])

  const wide = useIsWide()
  const [activeMetric, setActiveMetric] = useState(null)
  const tz = data?.schedule?.timezone || timeZone
  const metrics = useMemo(() => {
    const c = counts
    const val = (n) => (c ? n : "—")
    const pct = (n) => (c && c.total > 0 ? `${Math.round((n / c.total) * 100)}%` : "—")
    const toItems = (rows, withLate) =>
      (rows || []).map((r) => ({
        id: r.employeeId,
        primary: r.name,
        to: `/employees/${r.employeeId}`,
        badge: withLate && r.status === "LATE" && r.lateMinutes > 0 ? formatLate(r.lateMinutes) : null,
        secondary: r.checkInAt ? formatTime(r.checkInAt, { timeZone: tz }) : null,
      }))
    const onLeave = (data?.rows || []).filter((r) => r.status === "LEAVE").length
    const earliest = (lists.present || []).filter((r) => r.checkInAt).sort((x, y) => x.checkInAt.localeCompare(y.checkInAt))[0]
    const attendance = (status) => `/attendance?date=${selected}&status=${status}`
    return [
      {
        id: "total", title: "Total Employees", value: val(c?.total), icon: TotalEmployeesIcon, tone: "blue",
        description: "Active workforce",
        stats: [
          { label: "Present", value: val(c?.present) },
          { label: "Late", value: val(c?.late) },
          { label: "Absent", value: val(c?.absent) },
        ],
        items: toItems(lists.total), emptyText: "No employees.",
        action: { label: "View Employees", to: "/employees" },
      },
      {
        id: "present", title: "Present", value: val(c?.present), icon: PresentIcon, tone: "green",
        description: isToday ? "Employees currently present" : "Employees present",
        stats: [
          { label: "Attendance", value: pct(c?.present ?? 0) },
          ...(earliest ? [{ label: "First check-in", value: formatTime(earliest.checkInAt, { timeZone: tz }) }] : []),
        ],
        items: toItems(lists.present, true), emptyText: "Nobody has checked in.",
        action: { label: "View Attendance", to: attendance("present") },
      },
      {
        id: "late", title: isToday ? "Late Today" : "Late", value: val(c?.late), icon: LateIcon, tone: "amber",
        description: "Employees arriving late",
        stats: [{ label: "Of workforce", value: pct(c?.late ?? 0) }],
        items: toItems(lists.late, true), emptyText: "Nobody was late.",
        action: { label: "View Attendance", to: attendance("late") },
      },
      {
        id: "absent", title: isToday ? "Absent Today" : "Absent", value: val(c?.absent), icon: AbsentIcon, tone: "red",
        description: isToday ? "Employees absent today" : "Employees absent",
        stats: [
          { label: "Of workforce", value: pct(c?.absent ?? 0) },
          { label: "On leave", value: c ? onLeave : "—" },
        ],
        items: toItems(lists.absent), emptyText: "Nobody is absent.",
        action: { label: "View Attendance", to: attendance("absent") },
      },
    ]
  }, [counts, lists, data, selected, isToday, tz])
  const arrowClass =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-ink sm:h-10 sm:w-10"

  return (
    <div className="p-4 sm:p-5 lg:p-6">
      {/* Heading + 7-day selector */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink sm:text-lg">Attendance Snapshot</p>
          <p className="mt-0.5 text-xs leading-5 text-muted sm:text-sm">Overview of attendance for your team</p>
        </div>

        {wide && activeMetric && (
          <MetricNav metrics={metrics} activeId={activeMetric} onSelect={setActiveMetric} className="min-w-[300px] flex-1 lg:max-w-[460px]" />
        )}

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
        <div className="rounded-2xl border border-border p-3 sm:p-4 md:h-[280px] lg:h-[300px]">
          <InteractiveMetricWorkspace metrics={metrics} wide={wide} loading={loading} external activeId={activeMetric} onActiveChange={setActiveMetric} />
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
