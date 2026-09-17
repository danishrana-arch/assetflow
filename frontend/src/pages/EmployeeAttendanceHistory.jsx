import { useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import EmptyState from "../components/ui/EmptyState"
import StatusPill from "../components/ui/StatusPill"

const ATTENDANCE_STATUS_TONE = { PRESENT: "green", LATE: "yellow", ABSENT: "pink", LEAVE: "blue" }

function fmtDate(value) {
  if (!value) return "—"
  return new Date(value).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" })
}

function fmtTime(value) {
  if (!value) return null
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

// Full check-in/check-out history for one employee, linked to from a button
// on their profile page. Reuses the same `["employee", id]` query the
// profile page already fetches, so it's typically served straight from
// cache when navigated to from there.
export default function EmployeeAttendanceHistory() {
  const { id } = useParams()

  const { data: employee, isLoading } = useQuery({
    queryKey: ["employee", id],
    queryFn: () => api.get(`/employees/${id}`).then((r) => r.data),
  })

  if (isLoading) return <p className="text-sm text-muted">Loading...</p>
  if (!employee) return <p className="text-sm text-muted">Employee not found.</p>

  const records = [...(employee.attendanceRecords || [])].sort((a, b) => new Date(b.date) - new Date(a.date))

  return (
    <div>
      <PageHeader
        title="Attendance History"
        subtitle={`${employee.name} · most recent ${records.length} record${records.length === 1 ? "" : "s"}`}
        backTo={`/employees/${id}`}
      />

      <div className="card p-5">
        {records.length ? (
          <div className="space-y-1.5">
            {records.map((record) => (
              <div key={record.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{fmtDate(record.date)}</p>
                  <p className="text-xs text-muted">
                    {fmtTime(record.checkInAt) || "—"}
                    {record.checkOutAt ? ` – ${fmtTime(record.checkOutAt)}` : ""}
                    {record.locationMode === "WFH" ? " · Working from home" : ""}
                  </p>
                </div>
                <StatusPill tone={ATTENDANCE_STATUS_TONE[record.status] || "slate"}>{record.status}</StatusPill>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No attendance records yet" description="Attendance will appear here once check-ins begin." />
        )}
      </div>
    </div>
  )
}
