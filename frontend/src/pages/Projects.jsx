import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FolderKanban,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react"
import { useAuth } from "../context/AuthContext"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import Avatar from "../components/ui/Avatar"

const STATUS = {
  NOT_STARTED: { label: "Not Started", icon: Clock3, tone: "text-amber-600", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  IN_PROGRESS: { label: "In Progress", icon: FolderKanban, tone: "text-blue-600", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  COMPLETED: { label: "Completed", icon: CheckCircle2, tone: "text-emerald-600", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
}

const TECHNOLOGIES = [
  "React",
  "Node.js",
  "Express.js",
  "MongoDB",
  "MERN",
  "Next.js",
  "TypeScript",
  "JavaScript",
  "Vue.js",
  "Angular",
  "PostgreSQL",
  "MySQL",
  "Python",
  "Django",
  ".NET",
  "PHP",
  "Laravel",
  "Flutter",
  "React Native",
  "Other",
]

function formatDate(value) {
  if (!value) return "No deadline"
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
}

function deadlineEndTime(value) {
  if (!value) return null
  const date = new Date(value)
  date.setUTCHours(23, 59, 59, 999)
  return date.getTime()
}

function isExpired(project) {
  const deadline = deadlineEndTime(project.deadline)
  return Boolean(deadline && project.status !== "COMPLETED" && deadline < Date.now())
}

function EmployeeOption({ employee, selected, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(employee)}
      className={`flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left last:border-0 hover:bg-surface-2 ${selected ? "bg-accent/5" : ""}`}
    >
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? "border-accent bg-accent text-white" : "border-border"}`}>
        {selected ? "✓" : ""}
      </span>
      <Avatar name={employee.name} src={employee.photoUrl} size="xs" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-ink">{employee.name}</span>
        <span className="mt-0.5 block truncate text-[10px] text-muted">
          {employee.skill || employee.role || "Employee"}
          {employee.email ? ` · ${employee.email}` : ""}
        </span>
      </span>
    </button>
  )
}

function StatusCard({ status, count, active, onClick }) {
  const meta = STATUS[status]
  const Icon = meta.icon
  return (
    <button
      onClick={onClick}
      className={`card w-full p-5 text-left transition-all hover:-translate-y-0.5 ${active ? `ring-2 ring-accent ${meta.border}` : ""}`}
    >
      <div className="flex items-center justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${meta.bg} ${meta.tone}`}><Icon size={19} /></div>
        <span className={`text-3xl font-semibold ${meta.tone}`}>{count}</span>
      </div>
      <p className="mt-4 text-sm font-semibold text-ink">{meta.label}</p>
      <p className="mt-1 text-xs text-muted">Click to filter projects</p>
    </button>
  )
}

function ProjectCard({ project, onOpen }) {
  const meta = STATUS[project.status]
  const expired = isExpired(project)
  return (
    <button onClick={() => onOpen(project)} className="card group w-full p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-ink">{project.name}</p>
          <p className="mt-1 truncate text-xs text-muted">{project.clientName || "Internal project"}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${meta.bg} ${meta.tone}`}>{meta.label}</span>
      </div>

      {project.technologies?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {project.technologies.slice(0, 4).map(tech => <span key={tech} className="rounded-full bg-surface-2 px-2 py-1 text-[9px] font-medium text-muted">{tech}</span>)}
          {project.technologies.length > 4 && <span className="rounded-full bg-surface-2 px-2 py-1 text-[9px] font-medium text-muted">+{project.technologies.length - 4}</span>}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-surface-2 p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted">Deadline</p>
          <p className={`mt-1 text-xs font-semibold ${expired ? "text-red-600" : "text-ink"}`}>{expired ? "Overdue" : formatDate(project.deadline)}</p>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted">Time spent</p>
          <p className="mt-1 text-xs font-semibold text-ink">{Number(project.totalHours || 0).toFixed(1)} hrs</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex -space-x-2">
          {(project.members || []).slice(0, 4).map(member => <Avatar key={member.id} name={member.employee.name} src={member.employee.photoUrl} size="xs" className="border-2 border-surface" />)}
          {(project.members?.length || 0) > 4 && <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-surface-2 text-[10px] font-semibold text-muted">+{project.members.length - 4}</span>}
        </div>
        <span className="text-xs font-medium text-muted group-hover:text-accent">View details →</span>
      </div>
    </button>
  )
}

function ProjectDetails({ project, onClose, onRefresh }) {
  const [hours, setHours] = useState({})
  const [newDeadline, setNewDeadline] = useState(project.deadline ? project.deadline.slice(0, 10) : "")
  const [status, setStatus] = useState(project.status)
  const [projectUrl, setProjectUrl] = useState(project.projectUrl || "")
  const [technologies, setTechnologies] = useState(project.technologies || [])

  useEffect(() => {
    setHours(Object.fromEntries((project.members || []).map(m => [m.id, Number(m.hoursSpent || 0)])))
    setNewDeadline(project.deadline ? project.deadline.slice(0, 10) : "")
    setStatus(project.status)
    setProjectUrl(project.projectUrl || "")
    setTechnologies(project.technologies || [])
  }, [project])

  const update = useMutation({
    mutationFn: payload => api.patch(`/projects/${project.id}`, payload),
    onSuccess: () => onRefresh(),
  })

  const saveProject = () => update.mutate({ status, deadline: newDeadline || null, projectUrl: projectUrl.trim() || null, technologies })
  const saveHours = memberId => api.patch(`/projects/${project.id}/members/${memberId}`, { hoursSpent: hours[memberId] }).then(onRefresh)
  const completedNeedsLink = status === "COMPLETED" && !projectUrl.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-surface shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-surface/95 p-6 backdrop-blur">
          <div><p className="text-xl font-semibold text-ink">{project.name}</p><p className="mt-1 text-xs text-muted">{project.clientName || "Internal project"}</p></div>
          <button onClick={onClose} className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-ink"><X size={18} /></button>
        </div>

        <div className="grid gap-5 p-6 lg:grid-cols-3">
          <div className="card p-4 lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Project overview</p>
            <p className="mt-3 text-sm leading-6 text-ink">{project.description || "No description has been added."}</p>
            {project.projectUrl && <a href={project.projectUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-accent hover:underline">Open project link <ExternalLink size={13} /></a>}
          </div>
          <div className="card p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Time spent</p><p className="mt-2 text-3xl font-semibold text-ink">{Number(project.totalHours || 0).toFixed(1)}h</p><p className="mt-1 text-xs text-muted">Across all assigned employees</p></div>
        </div>

        <div className="px-6 pb-6">
          <div className="card p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label><span className="text-xs font-medium text-muted">Project status</span><select value={status} onChange={e => setStatus(e.target.value)} className="field mt-1 w-full text-xs">{Object.entries(STATUS).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>
              <label><span className="text-xs font-medium text-muted">Deadline</span><input type="date" value={newDeadline} onChange={e => setNewDeadline(e.target.value)} className="field mt-1 w-full text-xs" /></label>
              <label className="md:col-span-2"><span className="text-xs font-medium text-muted">Project link {status === "COMPLETED" ? "(required)" : "(optional)"}</span><input value={projectUrl} onChange={e => setProjectUrl(e.target.value)} className="field mt-1 w-full text-xs" placeholder="https://..." /></label>
            </div>

            <div className="mt-4">
              <p className="text-xs font-medium text-muted">Technologies</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {TECHNOLOGIES.map(tech => {
                  const active = technologies.includes(tech)
                  return <button type="button" key={tech} onClick={() => setTechnologies(prev => active ? prev.filter(item => item !== tech) : [...prev, tech])} className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${active ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-ink"}`}>{tech}</button>
                })}
              </div>
            </div>

            {completedNeedsLink && <p className="mt-3 text-xs font-medium text-red-600">A project link is required before this project can be marked completed.</p>}
            <button onClick={saveProject} disabled={update.isPending || completedNeedsLink} className="pill-accent mt-5 px-4 py-2.5 text-xs disabled:opacity-50">{update.isPending ? "Saving…" : "Save project changes"}</button>
          </div>
        </div>

        <div className="px-6 pb-7">
          <div className="card overflow-hidden">
            <div className="border-b border-border p-5"><p className="text-sm font-semibold text-ink">Employees working on this project</p><p className="mt-1 text-xs text-muted">{project.members?.length || 0} assigned employees</p></div>
            <div className="divide-y divide-border">
              {(project.members || []).map(member => (
                <div key={member.id} className="flex items-center gap-3 p-4">
                  <Avatar name={member.employee.name} src={member.employee.photoUrl} size="sm" />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{member.employee.name}</p><p className="truncate text-[11px] text-muted">{member.employee.skill || member.employee.department?.name || member.employee.role}{member.employee.email ? ` · ${member.employee.email}` : ""}</p></div>
                  <div className="flex items-center gap-2"><input type="number" min="0" step="0.5" value={hours[member.id] ?? 0} onChange={e => setHours(prev => ({ ...prev, [member.id]: e.target.value }))} className="field w-24 text-xs" /><span className="text-xs text-muted">hrs</span><button onClick={() => saveHours(member.id)} className="rounded-xl bg-surface-2 px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-3">Save</button></div>
                </div>
              ))}
              {project.members?.length === 0 && <div className="p-6 text-sm text-muted">No employees assigned yet.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DeadlineModal({ project, onClose, onCompleted, onExtended }) {
  const [date, setDate] = useState("")
  const [link, setLink] = useState(project.projectUrl || "")
  const mutation = useMutation({
    mutationFn: ({ status, deadline, projectUrl }) => api.patch(`/projects/${project.id}`, { status, deadline, projectUrl }),
    onSuccess: (_, variables) => variables.status === "COMPLETED" ? onCompleted() : onExtended(),
  })
  const canComplete = Boolean(link.trim())

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-surface p-6 shadow-2xl">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10 text-red-600"><CalendarClock size={20} /></div>
        <h3 className="mt-5 text-lg font-semibold text-ink">Project deadline reached</h3>
        <p className="mt-2 text-sm leading-6 text-muted"><strong className="text-ink">{project.name}</strong> has reached its deadline. Mark it completed or extend the deadline.</p>
        <label className="mt-5 block"><span className="text-xs font-medium text-muted">Project link {project.projectUrl ? "" : "(required to complete)"}</span><input value={link} onChange={e => setLink(e.target.value)} className="field mt-1 w-full" placeholder="https://..." /></label>
        <div className="mt-4"><label className="text-xs font-medium text-muted">New deadline</label><input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} className="field mt-1 w-full" /></div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button onClick={() => canComplete && mutation.mutate({ status: "COMPLETED", deadline: project.deadline, projectUrl: link.trim() })} disabled={!canComplete || mutation.isPending} className="rounded-2xl bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-700 disabled:opacity-50">Yes, complete it</button>
          <button onClick={() => date && mutation.mutate({ status: project.status, deadline: date, projectUrl: link.trim() || null })} disabled={!date || mutation.isPending} className="pill-accent px-4 py-2.5 text-xs disabled:opacity-50">Increase deadline</button>
        </div>
        <button onClick={onClose} className="mt-3 w-full rounded-2xl px-4 py-2.5 text-xs font-medium text-muted hover:bg-surface-2">Decide later</button>
      </div>
    </div>
  )
}

function CreateProjectModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", clientName: "", projectUrl: "", deadline: "", status: "NOT_STARTED", memberIds: [], technologies: [] })
  const [employeeSearch, setEmployeeSearch] = useState("")
  const [selectedEmployees, setSelectedEmployees] = useState([])

  const employeesQuery = useQuery({
    queryKey: ["project-employee-search", employeeSearch],
    queryFn: () => api.get("/employees", { params: { search: employeeSearch || undefined, page: 1, pageSize: 25, status: "ACTIVE" } }).then(r => r.data.data || []),
    staleTime: 30_000,
  })

  const mutation = useMutation({
    mutationFn: () => api.post("/projects", form),
    onSuccess: res => onCreated(res.data),
  })

  const toggleEmployee = employee => {
    const selected = selectedEmployees.some(item => item.id === employee.id)
    const next = selected ? selectedEmployees.filter(item => item.id !== employee.id) : [...selectedEmployees, employee]
    setSelectedEmployees(next)
    setForm(prev => ({ ...prev, memberIds: next.map(item => item.id) }))
  }

  const toggleTechnology = tech => setForm(prev => ({ ...prev, technologies: prev.technologies.includes(tech) ? prev.technologies.filter(item => item !== tech) : [...prev.technologies, tech] }))
  const completedNeedsLink = form.status === "COMPLETED" && !form.projectUrl.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-surface p-6 shadow-2xl">
        <div className="flex items-start justify-between"><div><h3 className="text-lg font-semibold text-ink">Add project</h3><p className="mt-1 text-xs text-muted">Create the project, choose its technology stack, and assign its working team.</p></div><button onClick={onClose} className="rounded-full p-2 text-muted hover:bg-surface-2"><X size={18} /></button></div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="text-xs font-medium text-muted">Project name</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="field mt-1 w-full" placeholder="Website redesign" /></label>
          <label><span className="text-xs font-medium text-muted">Client</span><input value={form.clientName} onChange={e => setForm({ ...form, clientName: e.target.value })} className="field mt-1 w-full" placeholder="Client name" /></label>
          <label><span className="text-xs font-medium text-muted">Deadline</span><input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} className="field mt-1 w-full" /></label>
          <label className="sm:col-span-2"><span className="text-xs font-medium text-muted">Project link {form.status === "COMPLETED" ? "(required)" : "(optional)"}</span><input value={form.projectUrl} onChange={e => setForm({ ...form, projectUrl: e.target.value })} className="field mt-1 w-full" placeholder="https://..." /></label>
          <label className="sm:col-span-2"><span className="text-xs font-medium text-muted">Status</span><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="field mt-1 w-full">{Object.entries(STATUS).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>
        </div>

        <div className="mt-5"><p className="text-xs font-semibold text-ink">Technologies</p><div className="mt-2 flex flex-wrap gap-2">{TECHNOLOGIES.map(tech => <button type="button" key={tech} onClick={() => toggleTechnology(tech)} className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${form.technologies.includes(tech) ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-ink"}`}>{tech}</button>)}</div></div>

        <div className="mt-6">
          <div className="flex items-center justify-between"><p className="text-xs font-semibold text-ink">Assign employees</p><p className="text-[11px] text-muted">{selectedEmployees.length} selected</p></div>

          {selectedEmployees.length > 0 && (
            <div className="mt-2 rounded-2xl border border-accent/20 bg-accent/5 p-2">
              <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Selected employees</p>
              <div className="flex flex-wrap gap-2">
                {selectedEmployees.map(employee => <button key={employee.id} type="button" onClick={() => toggleEmployee(employee)} className="flex items-center gap-2 rounded-xl bg-surface px-2.5 py-2 text-left shadow-sm"><Avatar name={employee.name} src={employee.photoUrl} size="xs" /><span className="min-w-0"><span className="block max-w-[160px] truncate text-[10px] font-semibold text-ink">{employee.name}</span><span className="block max-w-[160px] truncate text-[9px] text-muted">{employee.skill || employee.role || "Employee"}</span></span><X size={12} className="text-muted" /></button>)}
              </div>
            </div>
          )}

          <div className="relative mt-3"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input value={employeeSearch} onChange={e => setEmployeeSearch(e.target.value)} className="field w-full pl-9" placeholder="Search by name, email, or skill…" /></div>
          <div className="mt-2 max-h-56 overflow-y-auto rounded-2xl border border-border">
            {employeesQuery.isLoading ? <div className="p-5 text-center text-xs text-muted">Searching employees…</div> : employeesQuery.data?.length ? employeesQuery.data.map(employee => <EmployeeOption key={employee.id} employee={employee} selected={selectedEmployees.some(item => item.id === employee.id)} onToggle={toggleEmployee} />) : <div className="p-5 text-center text-xs text-muted">No employees found.</div>}
          </div>
          <p className="mt-2 text-[10px] text-muted">Only 25 matching employees are loaded at a time, so the selector stays fast even with hundreds of employees.</p>
        </div>

        {completedNeedsLink && <p className="mt-4 text-xs font-medium text-red-600">A project link is required when the project status is Completed.</p>}
        <div className="mt-6 flex justify-end gap-2"><button onClick={onClose} className="rounded-2xl px-4 py-2.5 text-xs font-semibold text-muted hover:bg-surface-2">Cancel</button><button onClick={() => mutation.mutate()} disabled={!form.name.trim() || completedNeedsLink || mutation.isPending} className="pill-accent inline-flex items-center gap-2 px-4 py-2.5 text-xs disabled:opacity-50"><Plus size={14} />{mutation.isPending ? "adding…" : "Add project"}</button></div>
        {mutation.isError && <p className="mt-3 text-right text-xs font-medium text-red-600">{mutation.error?.response?.data?.error || "Unable to create the project."}</p>}
      </div>
    </div>
  )
}

export default function Projects() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [activeStatus, setActiveStatus] = useState(null)
  const [search, setSearch] = useState("")
  const [deadlineFilter, setDeadlineFilter] = useState("ALL")
  const [selected, setSelected] = useState(null)
  const [expired, setExpired] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects", activeStatus, search],
    queryFn: () => api.get("/projects", { params: { status: activeStatus || undefined, search: search || undefined } }).then(r => r.data),
  })

  const countsQuery = useQuery({
    queryKey: ["projects-counts"],
    queryFn: async () => {
      const [a, b, c] = await Promise.all(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"].map(status => api.get("/projects", { params: { status } }).then(r => r.data.length)))
      return { NOT_STARTED: a, IN_PROGRESS: b, COMPLETED: c }
    },
  })

  useEffect(() => {
    const firstExpired = projects.find(isExpired)
    if (firstExpired && !sessionStorage.getItem(`project-deadline-${firstExpired.id}-${firstExpired.deadline}`)) {
      sessionStorage.setItem(`project-deadline-${firstExpired.id}-${firstExpired.deadline}`, "1")
      setExpired(firstExpired)
    }
  }, [projects])

  const visibleProjects = useMemo(() => {
    if (deadlineFilter === "OVERDUE") return projects.filter(isExpired)
    if (deadlineFilter === "UPCOMING") {
      const now = Date.now()
      const week = now + 7 * 86400000
      return projects.filter(p => {
        const deadline = deadlineEndTime(p.deadline)
        return deadline && deadline >= now && deadline <= week
      })
    }
    return projects
  }, [projects, deadlineFilter])

  const refresh = async id => {
    await queryClient.invalidateQueries({ queryKey: ["projects"] })
    await queryClient.invalidateQueries({ queryKey: ["projects-counts"] })
    if (id) setSelected(await api.get(`/projects/${id}`).then(r => r.data))
  }

  const isManagement = ["ADMIN", "CEO", "SALES_HEAD", "HR", "MANAGER"].includes(user?.role)
  if (!isManagement) return null

  return (
    <div>
      <PageHeader title="Projects" subtitle="Track company projects, deadlines, teams, technology, and time spent." backTo="/" actions={<button onClick={() => setCreateOpen(true)} className="pill-accent inline-flex items-center gap-2 px-4 py-2.5 text-xs"><Plus size={15} /> New Project</button>} />

      <div className="grid gap-4 md:grid-cols-3">{["NOT_STARTED", "IN_PROGRESS", "COMPLETED"].map(status => <StatusCard key={status} status={status} count={countsQuery.data?.[status] ?? 0} active={activeStatus === status} onClick={() => setActiveStatus(activeStatus === status ? null : status)} />)}</div>

      <div className="mt-5 card p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects or clients…" className="field w-full pl-9" /></div><select value={deadlineFilter} onChange={e => setDeadlineFilter(e.target.value)} className="field lg:w-48"><option value="ALL">All deadlines</option><option value="UPCOMING">Due in 7 days</option><option value="OVERDUE">Overdue</option></select>{activeStatus && <button onClick={() => setActiveStatus(null)} className="rounded-xl bg-surface-2 px-4 py-2.5 text-xs font-semibold text-muted hover:text-ink">Clear status</button>}</div></div>

      <div className="mt-5"><div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold text-ink">{activeStatus ? STATUS[activeStatus].label : "All Projects"}</p><p className="text-xs text-muted">{visibleProjects.length} project{visibleProjects.length === 1 ? "" : "s"}</p></div>{isLoading ? <div className="card p-10 text-center text-sm text-muted">Loading projects…</div> : visibleProjects.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleProjects.map(project => <ProjectCard key={project.id} project={project} onOpen={setSelected} />)}</div> : <div className="card p-12 text-center"><Users size={24} className="mx-auto text-muted" /><p className="mt-3 text-sm font-semibold text-ink">No projects found</p><p className="mt-1 text-xs text-muted">Try changing the status, deadline, or search filters.</p></div>}</div>

      {createOpen && <CreateProjectModal onClose={() => setCreateOpen(false)} onCreated={async project => { setCreateOpen(false); await refresh(); setSelected(project) }} />}
      {selected && <ProjectDetails project={selected} onClose={() => setSelected(null)} onRefresh={() => refresh(selected.id)} />}
      {expired && <DeadlineModal project={expired} onClose={() => setExpired(null)} onCompleted={() => { setExpired(null); refresh() }} onExtended={() => { setExpired(null); refresh() }} />}
    </div>
  )
}
