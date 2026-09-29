import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { FolderKanban } from "lucide-react"
import api from "../api/client"
import IconChip from "./ui/IconChip"
import SectionHeader from "./ui/SectionHeader"

const STATUS = {
  IN_PROGRESS: { label: "In progress", pill: "bg-chip-blue-bg text-chip-blue-fg", tone: "blue" },
  NOT_STARTED: { label: "Not started", pill: "bg-chip-slate-bg text-chip-slate-fg", tone: "slate" },
  COMPLETED: { label: "Completed", pill: "bg-chip-green-bg text-chip-green-fg", tone: "green" },
}
// Active work first, then upcoming, then done.
const ORDER = { IN_PROGRESS: 0, NOT_STARTED: 1, COMPLETED: 2 }
const LIST_LIMIT = 4

const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" })

// Deadlines are date-only (@db.Date → midnight UTC), so compare as UTC days.
function deadlineLabel(project) {
  if (!project.deadline) return null
  const due = new Date(project.deadline)
  const todayKey = new Date().toISOString().slice(0, 10)
  const overdue = project.status !== "COMPLETED" && project.deadline.slice(0, 10) < todayKey
  return { text: overdue ? `Overdue · ${dayFmt.format(due)}` : `Due ${dayFmt.format(due)}`, overdue }
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

  const counts = { COMPLETED: 0, IN_PROGRESS: 0, NOT_STARTED: 0 }
  projects.forEach((p) => { if (p.status in counts) counts[p.status] += 1 })

  const shown = [...projects]
    .sort((a, b) =>
      (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3) ||
      (a.deadline || "9999").localeCompare(b.deadline || "9999")
    )
    .slice(0, LIST_LIMIT)

  return (
    <div className="card flex min-w-0 flex-col p-4 sm:p-5 lg:p-6">
      <SectionHeader
        title="Project Tracker"
        action={
          <Link to="/projects" className="text-xs font-semibold text-accent">
            View all
          </Link>
        }
      />

      <ul className="flex-1 space-y-3">
        {shown.map((p) => {
          const cfg = STATUS[p.status] || STATUS.NOT_STARTED
          const due = deadlineLabel(p)
          const members = p._count?.members ?? p.members?.length ?? 0
          return (
            <li key={p.id}>
              <Link to="/projects" className="group flex min-w-0 items-center gap-3">
                <IconChip icon={FolderKanban} tone={cfg.tone} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink group-hover:text-accent">{p.name}</p>
                  <p className="truncate text-[11px] text-muted">
                    {[p.clientName, `${members} member${members === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.pill}`}>{cfg.label}</span>
                  {due && (
                    <span className={`text-[10px] ${due.overdue ? "font-semibold text-danger" : "text-muted"}`}>{due.text}</span>
                  )}
                </div>
              </Link>
            </li>
          )
        })}

        {isLoading && <li className="text-sm text-muted">Loading projects…</li>}
        {isError && <li className="text-sm text-danger">Couldn't load projects.</li>}
        {!isLoading && !isError && projects.length === 0 && (
          <li className="text-sm text-muted">No projects yet.</li>
        )}
      </ul>

      {/* Status totals in one row */}
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-4">
        {[
          ["COMPLETED", "Completed"],
          ["IN_PROGRESS", "In progress"],
          ["NOT_STARTED", "Not started"],
        ].map(([key, label]) => (
          <div key={key} className="min-w-0 rounded-xl bg-surface-2 px-2 py-2.5 text-center">
            <p className="text-lg font-semibold leading-tight text-ink">{isLoading ? "—" : counts[key]}</p>
            <p className="mt-0.5 truncate text-[10px] text-muted sm:text-[11px]">{label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
