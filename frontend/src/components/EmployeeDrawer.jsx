import { useMemo } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ExternalLink } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { hasModuleAccess, ROLE_LABELS } from "../utils/roles"
import { formatTime, formatDateTime } from "../utils/time"
import DetailDrawer from "./ui/DetailDrawer"
import MetricCard from "./ui/MetricCard"
import Avatar from "./ui/Avatar"
import StatusBadge from "./StatusBadge"
import StatusPill from "./ui/StatusPill"

// Employee workspace opened from lists, search and links. Everything comes
// from the existing GET /employees/:id (same query key the profile page uses),
// so the server's own redaction decides what each viewer gets: a tab simply
// does not appear when its data was not sent (e.g. IT only receives assets).

const day = (v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
const ATT_TONE = { PRESENT: "green", LATE: "yellow", ABSENT: "pink", LEAVE: "blue" }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function Row({ children, to }) {
  const cls = "flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2.5 text-sm"
  return to ? <Link to={to} className={`${cls} hover:bg-surface-2`}>{children}</Link> : <div className={cls}>{children}</div>
}
const Empty = ({ children }) => <p className="py-8 text-center text-sm text-muted">{children}</p>

function Field({ label, children }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface px-3 py-2.5">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-ink">{children || <span className="text-muted-2">—</span>}</dd>
    </div>
  )
}

function PerformanceTab({ employeeId }) {
  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ["performance", employeeId],
    queryFn: () => api.get(`/performance/${employeeId}`).then((r) => r.data),
  })
  if (isLoading) return <Empty>Loading…</Empty>
  if (!reviews.length) return <Empty>No performance reviews yet.</Empty>
  return (
    <div className="space-y-2">
      {reviews.map((r) => (
        <Row key={r.id}>
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{MONTHS[new Date(r.periodStart).getUTCMonth()]} {new Date(r.periodStart).getUTCFullYear()}</span>
            {r.reviewer?.name && <span className="block truncate text-xs text-muted">by {r.reviewer.name}</span>}
          </span>
          <span className="shrink-0 font-semibold tabular-nums text-ink">{r.rating != null ? `${r.rating}/5` : "—"}</span>
        </Row>
      ))}
      <Link to="/performance" className="block pt-1 text-xs font-medium text-accent hover:underline">Open Performance</Link>
    </div>
  )
}

export default function EmployeeDrawer({ id, onClose, onOpenEmployee, breadcrumb = [{ label: "Employees" }] }) {
  const { user } = useAuth()
  const { data: emp, isLoading, isError } = useQuery({
    queryKey: ["employee", id],
    queryFn: () => api.get(`/employees/${id}`).then((r) => r.data),
    enabled: !!id,
  })

  const attendance = emp?.attendanceRecords
  const counts = useMemo(() => {
    const c = { PRESENT: 0, LATE: 0, ABSENT: 0, LEAVE: 0 }
    for (const r of attendance || []) if (c[r.status] != null) c[r.status] += 1
    return c
  }, [attendance])

  const canPerformance = hasModuleAccess(user?.role, "performance")
  const listOf = (status) => (attendance || []).filter((r) => r.status === status).slice(0, 8)

  const overview = emp && (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge type="employee" status={emp.status} />
        <StatusPill tone="slate">{ROLE_LABELS[emp.role] || emp.role}</StatusPill>
        {emp.workLocationType && <StatusPill tone="slate">{emp.workLocationType === "FIELD" ? "Field" : "Office"}</StatusPill>}
      </div>

      {attendance && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Attendance · last 90 days</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Present", "PRESENT", "green"], ["Late", "LATE", "amber"], ["Absent", "ABSENT", "red"], ["Leave", "LEAVE", "blue"]].map(([label, key, tone]) => (
              <MetricCard key={key} label={label} value={counts[key]} tone={tone}>
                {counts[key] > 0 ? (
                  <ul className="space-y-1">
                    {listOf(key).map((r) => (
                      <li key={r.id} className="flex justify-between text-xs"><span className="text-ink">{day(r.date)}</span><span className="text-muted">{r.checkInAt ? formatTime(r.checkInAt) : "—"}</span></li>
                    ))}
                    {counts[key] > 8 && <li className="text-xs text-muted">+ {counts[key] - 8} earlier</li>}
                  </ul>
                ) : null}
              </MetricCard>
            ))}
          </div>
        </section>
      )}

      <dl className="grid gap-2 sm:grid-cols-2">
        <Field label="Email">{emp.email}</Field>
        {emp.phone !== undefined && <Field label="Phone">{emp.phone}</Field>}
        <Field label="Department">{emp.department?.name}</Field>
        <Field label="Designation">{emp.designation}</Field>
        <Field label="Reports to">
          {emp.manager && (onOpenEmployee ? (
            <button type="button" onClick={() => onOpenEmployee(emp.manager.id)} className="text-accent hover:underline">{emp.manager.name}</button>
          ) : emp.manager.name)}
        </Field>
        {emp.joiningDate && <Field label="Joined">{day(emp.joiningDate)}</Field>}
      </dl>
    </div>
  )

  const tabs = emp ? [
    { key: "overview", label: "Overview", content: overview },
    attendance && {
      key: "attendance", label: "Attendance", count: attendance.length,
      content: attendance.length ? (
        <div className="space-y-2">
          {attendance.slice(0, 30).map((r) => (
            <Row key={r.id}>
              <span className="text-ink">{day(r.date)}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs tabular-nums text-muted">{r.checkInAt ? `${formatTime(r.checkInAt)} – ${r.checkOutAt ? formatTime(r.checkOutAt) : "open"}` : "—"}</span>
                <StatusPill tone={ATT_TONE[r.status] || "slate"}>{r.status}</StatusPill>
              </span>
            </Row>
          ))}
          <Link to={`/employees/${emp.id}/attendance`} className="block pt-1 text-xs font-medium text-accent hover:underline">Full attendance history</Link>
        </div>
      ) : <Empty>No attendance recorded.</Empty>,
    },
    emp.leaveApplications && {
      key: "leave", label: "Leave", count: emp.leaveApplications.length,
      content: emp.leaveApplications.length ? (
        <div className="space-y-2">
          {emp.leaveApplications.map((l) => (
            <Row key={l.id}>
              <span className="text-ink">{day(l.startDate)}{l.endDate && l.endDate !== l.startDate ? ` – ${day(l.endDate)}` : ""}</span>
              <StatusPill tone="blue">{l.isHalfDay ? "Half day " : ""}{l.type}</StatusPill>
            </Row>
          ))}
        </div>
      ) : <Empty>No approved leave.</Empty>,
    },
    emp.projectMemberships && {
      key: "projects", label: "Projects", count: emp.projectMemberships.length,
      content: emp.projectMemberships.length ? (
        <div className="space-y-2">
          {emp.projectMemberships.map((m) => (
            <Row key={m.id} to="/projects">
              <span className="truncate font-medium text-ink">{m.project?.name}</span>
              <StatusPill tone="slate">{String(m.project?.status || "").replace(/_/g, " ")}</StatusPill>
            </Row>
          ))}
        </div>
      ) : <Empty>Not on any project.</Empty>,
    },
    emp.assignedAssets && {
      key: "assets", label: "Assets", count: emp.assignedAssets.length,
      content: emp.assignedAssets.length ? (
        <div className="space-y-2">
          {emp.assignedAssets.map((a) => (
            <Row key={a.id} to={`/inventory/${a.id}`}>
              <span className="min-w-0"><span className="block truncate font-medium text-ink">{a.name}</span><span className="block truncate text-xs text-muted">{a.category}{a.serialNumber ? ` · ${a.serialNumber}` : ""}</span></span>
            </Row>
          ))}
        </div>
      ) : <Empty>No assets assigned.</Empty>,
    },
    canPerformance && { key: "performance", label: "Performance", content: <PerformanceTab employeeId={emp.id} /> },
    emp.lifecycleEvents && {
      key: "activity", label: "Activity", count: emp.lifecycleEvents.length,
      content: emp.lifecycleEvents.length ? (
        <div className="space-y-2">
          {emp.lifecycleEvents.map((e) => (
            <Row key={e.id}>
              <span className="min-w-0 truncate text-ink">{String(e.type).replace(/_/g, " ").toLowerCase()}{e.asset?.name ? ` · ${e.asset.name}` : ""}</span>
              <span className="shrink-0 text-xs text-muted">{formatDateTime(e.occurredAt)}</span>
            </Row>
          ))}
        </div>
      ) : <Empty>No recent activity.</Empty>,
    },
  ].filter(Boolean) : []

  return (
    <DetailDrawer
      open={!!id}
      onClose={onClose}
      resetKey={id}
      breadcrumb={breadcrumb}
      title={emp?.name || (isError ? "Employee unavailable" : "Loading…")}
      subtitle={emp ? emp.designation || ROLE_LABELS[emp.role] : undefined}
      leading={emp && <Avatar name={emp.name} src={emp.photoUrl} size="md" />}
      actions={emp && (
        <Link
          to={`/employees/${emp.id}`}
          title="Open full profile"
          aria-label="Open full profile"
          className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ExternalLink size={16} />
        </Link>
      )}
      tabs={tabs}
    >
      {isLoading && <Empty>Loading…</Empty>}
      {isError && <Empty>This employee could not be loaded.</Empty>}
    </DetailDrawer>
  )
}
