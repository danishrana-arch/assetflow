import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import api from "../api/client"
import StatusPill from "./ui/StatusPill"
import SectionHeader from "./ui/SectionHeader"

// Same look as the Projects card on the Employee Profile page: a big total
// with a dotted status breakdown, then up to four projects with their
// deadline and a status pill.
const STATUS = {
  NOT_STARTED: { label: "Not started", tone: "slate", dot: "bg-gray-400" },
  IN_PROGRESS: { label: "In progress", tone: "blue", dot: "bg-sky-500" },
  COMPLETED: { label: "Completed", tone: "green", dot: "bg-emerald-500" },
}
// Active work first, then upcoming, then done.
const ORDER = { IN_PROGRESS: 0, NOT_STARTED: 1, COMPLETED: 2 }
const LIST_LIMIT = 4

function fmtDate(value) {
  return new Date(value).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
}

// Reuses GET /projects (same list and role scoping as the Projects page:
// management sees the org's projects, a department head their department's,
// everyone else only the projects they're a member of). The counts below are
// computed from that same list, so they always match what's shown.
export default function ProjectTracker() {
  const { data: projects = [], isLoading, isError } = useQuery({
    queryKey: ["projects", "dashboard-tracker"],
    queryFn: () => api.get("/projects").then((r) => r.data),
  })

  const todayIso = new Date().toISOString().slice(0, 10)
  const breakdown = Object.entries(STATUS).map(([key, s]) => ({
    key, label: s.label, dot: s.dot, value: projects.filter((p) => (p.status || "NOT_STARTED") === key).length,
  }))
  const shown = [...projects]
    .sort((a, b) =>
      (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3) ||
      (a.deadline || "9999").localeCompare(b.deadline || "9999")
    )
    .slice(0, LIST_LIMIT)

  return (
    <section className="card flex min-w-0 flex-col p-5">
      <SectionHeader title="Project Tracker" action={<Link to="/projects" className="text-xs font-semibold text-accent">View all</Link>} />

      <div className="flex flex-1 items-center gap-5">
        <div className="shrink-0 border-r border-border pr-5">
          <p className="text-4xl font-bold tabular-nums text-ink" style={{ letterSpacing: "-0.03em" }}>{isLoading ? "—" : projects.length}</p>
          <p className="mt-1 text-xs font-medium text-muted">Total projects</p>
        </div>
        <ul className="min-w-0 flex-1 space-y-2.5">
          {breakdown.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-muted">
                <span className={`h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
                <span className="truncate">{item.label}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-ink">{isLoading ? "—" : item.value}</span>
            </li>
          ))}
        </ul>
      </div>

      {isLoading ? (
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted">Loading projects…</p>
      ) : isError ? (
        <p className="mt-4 border-t border-border pt-3 text-xs text-danger">Couldn't load projects.</p>
      ) : shown.length > 0 ? (
        <ul className="mt-4 space-y-1.5 border-t border-border pt-3">
          {shown.map((p) => {
            const status = STATUS[p.status] || STATUS.NOT_STARTED
            const deadline = p.deadline ? String(p.deadline).slice(0, 10) : null
            const overdue = deadline && deadline < todayIso && p.status !== "COMPLETED"
            return (
              <li key={p.id}>
                <Link to="/projects" className="group flex items-center justify-between gap-2 rounded-xl px-1 py-1">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink group-hover:text-accent">{p.name}</p>
                    {deadline && (
                      <p className={`text-[11px] ${overdue ? "font-semibold text-danger" : "text-muted"}`}>
                        {overdue ? "Overdue" : "Due"} {fmtDate(p.deadline)}
                      </p>
                    )}
                  </div>
                  <StatusPill tone={status.tone} className="shrink-0">{status.label}</StatusPill>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted">No projects yet.</p>
      )}
    </section>
  )
}
