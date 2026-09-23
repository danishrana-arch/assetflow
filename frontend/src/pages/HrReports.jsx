import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Users, UserCheck, Clock, Gauge, MapPin, LogOut as LogOutIcon, Timer, CalendarDays } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import IconChip from "../components/ui/IconChip"
import EmptyState from "../components/ui/EmptyState"

const ANOMALY_META = {
  LOCATION: { icon: MapPin, tone: "pink", label: "Location mismatch" },
  MISSING_CHECKOUT: { icon: LogOutIcon, tone: "orange", label: "Missing check-out" },
  LONG_DAY: { icon: Timer, tone: "purple", label: "Unusually long day" },
}

function formatDate(value) {
  if (!value) return "—"
  return new Date(value).toLocaleDateString()
}

export default function HrReports() {
  const { user } = useAuth()
  const canSwitchScope = ["ADMIN", "CEO"].includes(user?.role)
  const [scope, setScope] = useState("organization")
  const now = new Date()

  const { data: executive } = useQuery({
    queryKey: ["hr-reports-executive", scope],
    queryFn: () => api.get("/dashboard/executive", { params: { scope } }).then((r) => r.data),
  })

  const { data: anomalies = [] } = useQuery({
    queryKey: ["hr-reports-anomalies", scope],
    queryFn: () => api.get("/dashboard/attendance-anomalies", { params: { scope } }).then((r) => r.data),
  })

  const { data: leaveCalendar } = useQuery({
    queryKey: ["hr-reports-leave", now.getFullYear(), now.getMonth() + 1],
    queryFn: () => api.get("/leave/calendar", { params: { year: now.getFullYear(), month: now.getMonth() + 1 } }).then((r) => r.data),
  })

  const projectStatus = executive?.projectStatus || { NOT_STARTED: 0, IN_PROGRESS: 0, COMPLETED: 0 }
  const projectTotal = projectStatus.NOT_STARTED + projectStatus.IN_PROGRESS + projectStatus.COMPLETED

  return (
    <div>
      <PageHeader
        backTo="/"
        title="HR Reports"
        subtitle="Headcount, attendance, and leave at a glance."
        actions={canSwitchScope && (
          <div className="flex rounded-full border border-border p-1 text-xs">
            <button
              onClick={() => setScope("organization")}
              className={`rounded-full px-3 py-1.5 font-medium ${scope === "organization" ? "bg-accent text-on-accent" : "text-muted"}`}
            >
              This org
            </button>
            <button
              onClick={() => setScope("company")}
              className={`rounded-full px-3 py-1.5 font-medium ${scope === "company" ? "bg-accent text-on-accent" : "text-muted"}`}
            >
              Whole company
            </button>
          </div>
        )}
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard icon={Users} tone="blue" label="Headcount" value={executive?.employees ?? "—"} />
        <MetricCard icon={UserCheck} tone="purple" label="Present today" value={executive?.presentToday ?? "—"} />
        <MetricCard icon={Clock} tone="orange" label="Late today" value={executive?.late ?? "—"} />
        <MetricCard icon={Gauge} tone="pink" label="Attendance rate" value={executive ? `${executive.attendanceRate}%` : "—"} />
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <SectionHeader title="Today's Attendance Anomalies" showMenu />
          {anomalies.length > 0 ? (
            <ul className="space-y-3">
              {anomalies.map((a, i) => {
                const meta = ANOMALY_META[a.type] || { icon: Clock, tone: "blue", label: a.type }
                return (
                  <li key={i} className="flex items-center gap-3">
                    <IconChip icon={meta.icon} tone={meta.tone} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{a.employee?.name || "Unknown employee"}</p>
                      <p className="truncate text-[11px] text-muted">{a.message}</p>
                    </div>
                    <span className="shrink-0 text-[10px] font-semibold uppercase text-muted-2">{meta.label}</span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState icon={UserCheck} title="No anomalies today" description="Location mismatches, missing check-outs, and unusually long days will show up here." />
          )}
        </div>

        <div className="card p-5">
          <SectionHeader title="Project Status" showMenu />
          {projectTotal > 0 ? (
            <ul className="space-y-2">
              <ProjectStatusRow label="Not started" value={projectStatus.NOT_STARTED} total={projectTotal} color="#707978" />
              <ProjectStatusRow label="In progress" value={projectStatus.IN_PROGRESS} total={projectTotal} color="#0058BE" />
              <ProjectStatusRow label="Completed" value={projectStatus.COMPLETED} total={projectTotal} color="#16A34A" />
            </ul>
          ) : (
            <EmptyState icon={Gauge} title="No projects yet" description="Project status breakdown will appear once projects are created." />
          )}
        </div>
      </section>

      <section className="mt-5">
        <div className="card p-5">
          <SectionHeader title={`Approved Leave — ${now.toLocaleDateString(undefined, { month: "long", year: "numeric" })}`} showMenu />
          {leaveCalendar?.leaves?.length > 0 ? (
            <div className="space-y-2">
              {leaveCalendar.leaves.map((leave) => (
                <div key={leave.id} className="flex items-center gap-3 rounded-2xl border border-border p-3">
                  <IconChip icon={CalendarDays} tone="blue" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{leave.employee?.name}</p>
                    <p className="truncate text-[11px] text-muted">{leave.type} · {formatDate(leave.startDate)} – {formatDate(leave.endDate)}{leave.reason ? ` · ${leave.reason}` : ""}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={CalendarDays} title="No approved leave this month" description="Approved leave requests overlapping this month will be listed here." />
          )}
        </div>
      </section>
    </div>
  )
}

function MetricCard({ icon, tone, label, value }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <IconChip icon={icon} tone={tone} />
      <div className="min-w-0">
        <p className="text-xl font-bold text-ink">{value}</p>
        <p className="truncate text-xs text-muted">{label}</p>
      </div>
    </div>
  )
}

function ProjectStatusRow({ label, value, total, color }) {
  const pct = total ? Math.round((value / total) * 100) : 0
  return (
    <li className="flex items-center gap-3">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="flex-1 text-sm text-ink">{label}</span>
      <span className="text-xs text-muted">{value}</span>
      <span className="w-10 text-right text-xs font-semibold text-ink">{pct}%</span>
    </li>
  )
}
