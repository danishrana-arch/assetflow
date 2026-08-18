import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import StatusPill from "../components/ui/StatusPill"

const LEAVE_TYPE_TONE = { SICK: "pink", CASUAL: "blue", UNPAID: "slate" }
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function localKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function keysInRange(startIso, endIso) {
  const [sy, sm, sd] = startIso.slice(0, 10).split("-").map(Number)
  const [ey, em, ed] = endIso.slice(0, 10).split("-").map(Number)
  const keys = []
  let cursor = Date.UTC(sy, sm - 1, sd)
  const end = Date.UTC(ey, em - 1, ed)
  while (cursor <= end) {
    const d = new Date(cursor)
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`)
    cursor += 86400000
  }
  return keys
}

function buildGrid(year, month) {
  const first = new Date(year, month - 1, 1)
  const startOffset = first.getDay()
  const cells = []
  const start = new Date(year, month - 1, 1 - startOffset)
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    cells.push(d)
  }
  return cells
}

export default function LeaveCalendar() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1) // 1-12

  const { data, isLoading } = useQuery({
    queryKey: ["leave-calendar", year, month],
    queryFn: () => api.get("/leaves/calendar", { params: { year, month } }).then((r) => r.data),
  })

  const grid = useMemo(() => buildGrid(year, month), [year, month])

  const leavesByDay = useMemo(() => {
    const map = new Map()
    for (const leave of data?.leaves || []) {
      for (const key of keysInRange(leave.startDate, leave.endDate)) {
        if (!map.has(key)) map.set(key, [])
        map.get(key).push(leave)
      }
    }
    return map
  }, [data])

  function shiftMonth(delta) {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y -= 1 }
    if (m > 12) { m = 1; y += 1 }
    setMonth(m); setYear(y)
  }

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })

  return (
    <div>
      <PageHeader
        backTo="/"
        title="Leave Calendar"
        subtitle="Who's on approved leave, at a glance."
        actions={
          <div className="flex items-center gap-1.5 rounded-full border border-border-strong px-2 py-1.5">
            <button onClick={() => shiftMonth(-1)} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2" aria-label="Previous month">
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-[130px] text-center text-sm font-semibold text-ink">{monthLabel}</span>
            <button onClick={() => shiftMonth(1)} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2" aria-label="Next month">
              <ChevronRight size={15} />
            </button>
          </div>
        }
      />

      {isLoading && <p className="mb-3 text-sm text-muted">Loading…</p>}

      <div className="card overflow-hidden p-3">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
          {WEEKDAYS.map((d) => <div key={d} className="py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {grid.map((day) => {
            const inMonth = day.getMonth() === month - 1
            const key = localKey(day)
            const dayLeaves = leavesByDay.get(key) || []
            const isToday = key === localKey(now)
            return (
              <div
                key={key}
                className={`min-h-[92px] rounded-xl p-1.5 ${inMonth ? "bg-surface-2" : "bg-transparent opacity-40"}`}
              >
                <p className={`mb-1 text-xs font-semibold ${isToday ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white" : "text-muted"}`}>
                  {day.getDate()}
                </p>
                <div className="space-y-1">
                  {dayLeaves.slice(0, 3).map((l) => (
                    <div key={l.id} className="truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: "var(--surface)" }}>
                      <StatusPill tone={LEAVE_TYPE_TONE[l.type] || "slate"} className="!px-1.5 !py-0.5 !text-[10px]">
                        {l.employee?.name?.split(" ")[0]}
                      </StatusPill>
                    </div>
                  ))}
                  {dayLeaves.length > 3 && (
                    <p className="px-1 text-[10px] font-medium text-muted-2">+{dayLeaves.length - 3} more</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><StatusPill tone="pink">Sick</StatusPill></span>
        <span className="inline-flex items-center gap-1.5"><StatusPill tone="blue">Casual</StatusPill></span>
        <span className="inline-flex items-center gap-1.5"><StatusPill tone="slate">Unpaid</StatusPill></span>
      </div>
    </div>
  )
}
