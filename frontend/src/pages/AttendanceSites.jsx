import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { Building2, Clock3, FolderKanban, MapPin, Pencil, Plus, Save, Trash2, UserCog, Users, X } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { hasModuleAccess } from "../utils/roles"
import PageHeader from "../components/ui/PageHeader"
import EmptyState from "../components/ui/EmptyState"
import AttendanceSiteMap from "../components/AttendanceSiteMap"
import { TIMEZONE_GROUPS, timezoneLabel } from "../utils/timezones"

const DEFAULT_TZ = "Asia/Karachi"

function initialForm(organizationId, organizationTimezone) {
  return {
    name: "",
    address: "",
    latitude: "",
    longitude: "",
    radiusMeters: 250,
    outsideGraceMinutes: 60,
    geofenceMode: "STRICT",
    geofenceType: "RADIUS",
    boundary: [],
    areaSqMeters: 0,
    perimeterMeters: 0,
    timezone: organizationTimezone || DEFAULT_TZ,
    projectId: "",
    organizationId: organizationId || "",
  }
}

// listSites returns boundary as whatever Prisma's raw-query driver gives
// back for a jsonb column — already-parsed in practice, but this stays
// defensive since $queryRaw's exact JSON handling isn't part of any
// documented contract.
function siteToForm(site) {
  const boundary = Array.isArray(site.boundary)
    ? site.boundary
    : typeof site.boundary === "string"
      ? (() => { try { return JSON.parse(site.boundary) } catch { return [] } })()
      : []
  return {
    name: site.name || "",
    address: site.address || "",
    latitude: site.latitude != null ? String(site.latitude) : "",
    longitude: site.longitude != null ? String(site.longitude) : "",
    radiusMeters: site.radiusMeters ?? 250,
    outsideGraceMinutes: site.outsideGraceMinutes ?? 60,
    geofenceMode: site.geofenceMode || "STRICT",
    geofenceType: site.geofenceType || "RADIUS",
    boundary,
    areaSqMeters: Number(site.areaSqMeters || 0),
    perimeterMeters: Number(site.perimeterMeters || 0),
    timezone: site.timezone || DEFAULT_TZ,
    projectId: site.projectId || "",
    organizationId: site.organizationId || "",
  }
}

// Site Admins / Project Managers on one site (PUT /attendance-sites/:id/admins).
// ADMIN/CEO add or remove them; one person can hold many sites. Picking a
// plain Employee asks to change their role to Site Admin first.
function SiteAdminsSection({ site, canAssign }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState("")
  const [error, setError] = useState("")
  const admins = Array.isArray(site.siteAdmins) ? site.siteAdmins : []

  const { data: candidates = [] } = useQuery({
    queryKey: ["site-admin-candidates", site.organizationId],
    queryFn: () => api.get("/attendance-sites/site-admin-candidates", { params: { organizationId: site.organizationId } }).then((r) => r.data),
    enabled: canAssign,
    staleTime: 60000,
  })

  const save = useMutation({
    mutationFn: ({ userIds, convertEmployees }) => api.put(`/attendance-sites/${site.id}/admins`, { userIds, convertEmployees }).then((r) => r.data),
    onSuccess: () => {
      setAdding(""); setError("")
      queryClient.invalidateQueries({ queryKey: ["attendance-sites"] })
      queryClient.invalidateQueries({ queryKey: ["site-admin-candidates"] })
    },
    onError: (err) => setError(err.response?.data?.error || "Couldn't update Site Admins"),
  })

  function add(userId) {
    const person = candidates.find((c) => c.id === userId)
    if (!person) return
    let convertEmployees = false
    if (person.role === "EMPLOYEE") {
      if (!window.confirm(`${person.name} is an Employee. Change their role to Site Admin / Project Manager and assign them to ${site.name}?\n\nThey will be able to mark attendance only for this site's employees.`)) { setAdding(""); return }
      convertEmployees = true
    }
    save.mutate({ userIds: [...admins.map((a) => a.id), userId], convertEmployees })
  }

  function remove(admin) {
    if (!window.confirm(`Remove ${admin.name} as Site Admin of ${site.name}? Their past attendance actions stay in the history.`)) return
    save.mutate({ userIds: admins.filter((a) => a.id !== admin.id).map((a) => a.id) })
  }

  const assignedIds = new Set(admins.map((a) => a.id))
  const options = candidates.filter((c) => !assignedIds.has(c.id))

  return (
    <div className="mt-4">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted"><UserCog size={12} /> Site Admins / Project Managers</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {admins.map((admin) => (
          <span key={admin.id} className="inline-flex items-center gap-1 rounded-full bg-chip-blue-bg px-2.5 py-1 text-xs font-medium text-chip-blue-fg">
            {admin.name}
            {admin.role !== "SITE_ADMIN" && <span className="text-[9px] uppercase opacity-80" title="This person no longer has the Site Admin role, so this assignment has no effect">(not a Site Admin)</span>}
            {canAssign && (
              <button type="button" onClick={() => remove(admin)} disabled={save.isPending} className="rounded-full p-0.5 hover:bg-black/10 disabled:opacity-50" aria-label={`Remove ${admin.name}`}>
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {!admins.length && <span className="text-xs text-muted-2">No Site Admin yet.</span>}
        {canAssign && (
          <select
            value={adding}
            onChange={(e) => { setAdding(e.target.value); if (e.target.value) add(e.target.value) }}
            disabled={save.isPending}
            className="field h-8 w-auto py-1 text-xs"
            aria-label={`Add a Site Admin to ${site.name}`}
          >
            <option value="">+ Add Site Admin…</option>
            {options.filter((c) => c.role === "SITE_ADMIN").length > 0 && (
              <optgroup label="Site Admins">
                {options.filter((c) => c.role === "SITE_ADMIN").map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.siteCount ? ` · ${c.siteCount} site${c.siteCount === 1 ? "" : "s"}` : ""}</option>
                ))}
              </optgroup>
            )}
            {options.filter((c) => c.role === "EMPLOYEE").length > 0 && (
              <optgroup label="Employees (role will change to Site Admin)">
                {options.filter((c) => c.role === "EMPLOYEE").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            )}
          </select>
        )}
      </div>
      {canAssign && (
        <p className="mt-2 text-[10px] text-muted-2">
          A Site Admin marks check-in, check-out and absence for this site's employees (for workers without the app) from Site Attendance. They get no other admin access.
          To add someone new, create them on <Link to="/employees" className="font-semibold text-accent hover:underline">Employees</Link> with the Site Admin role.
        </p>
      )}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  )
}

export default function AttendanceSites() {
  const { user, organization, organizations } = useAuth()
  const queryClient = useQueryClient()
  const canManage = hasModuleAccess(user?.role, "attendance")
  // Granting Site Admin power is ADMIN/CEO only (same rule as the API).
  const canAssignSiteAdmins = ["ADMIN", "CEO"].includes(user?.role)
  // Can pick which company a site belongs to: CEO / ADMIN with more than one
  // accessible company (the list already follows the company hierarchy).
  const isMainCompanyAdmin = ["ADMIN", "CEO"].includes(user?.role) && (organizations || []).length > 1
  const [form, setForm] = useState(() => initialForm(organization?.id, organization?.timezone))
  const [error, setError] = useState("")
  const [editingId, setEditingId] = useState(null)

  const { data: projects = [] } = useQuery({
    queryKey: ["attendance-site-projects", form.organizationId],
    queryFn: () => api.get("/attendance-sites/projects", { params: { organizationId: form.organizationId } }).then((r) => Array.isArray(r.data) ? r.data : []),
    enabled: canManage && !!form.organizationId,
  })

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ["attendance-sites"],
    queryFn: () => api.get("/attendance-sites").then((r) => Array.isArray(r.data) ? r.data : []),
    enabled: canManage,
  })

  const remove = useMutation({
    mutationFn: (siteId) => api.delete(`/attendance-sites/${siteId}`),
    onSuccess: () => {
      setError("")
      queryClient.invalidateQueries({ queryKey: ["attendance-sites"] })
    },
    onError: (err) => setError(err.response?.data?.error || "Could not delete site"),
  })

  const create = useMutation({
    mutationFn: () => api.post("/attendance-sites", form),
    onSuccess: () => {
      setForm(initialForm(organization?.id, organization?.timezone))
      setError("")
      queryClient.invalidateQueries({ queryKey: ["attendance-sites"] })
    },
    onError: (err) => setError(err.response?.data?.error || "Could not create site"),
  })

  const update = useMutation({
    mutationFn: () => api.patch(`/attendance-sites/${editingId}`, form),
    onSuccess: () => {
      setEditingId(null)
      setForm(initialForm(organization?.id, organization?.timezone))
      setError("")
      queryClient.invalidateQueries({ queryKey: ["attendance-sites"] })
    },
    onError: (err) => setError(err.response?.data?.error || "Could not update site"),
  })

  function startEditing(site) {
    setEditingId(site.id)
    setForm(siteToForm(site))
    setError("")
  }

  function cancelEditing() {
    setEditingId(null)
    setForm(initialForm(organization?.id, organization?.timezone))
    setError("")
  }

  if (!canManage) return <EmptyState title="Site management is restricted" description="Contact your attendance administrator." />

  const selectedProject = projects.find((p) => p.id === form.projectId)

  return (
    <div>
      <PageHeader
        title="Attendance Sites"
        subtitle="Draw real project boundaries, assign them through projects, and control site attendance."
        backTo="/attendance"
        actions={
          <Link to="/projects" className="pill-secondary flex items-center gap-1.5 px-4 py-2.5 text-sm">
            <FolderKanban size={15} /> Projects
          </Link>
        }
      />

      <div className="space-y-5">
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {editingId ? <Pencil size={17} className="text-accent" /> : <Plus size={17} className="text-accent" />}
              <h2 className="text-sm font-semibold text-ink">{editingId ? "Edit site" : "Add site"}</h2>
            </div>
            {editingId && (
              <button type="button" onClick={cancelEditing} className="pill-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-xs">
                <X size={12} /> Cancel
              </button>
            )}
          </div>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted">Organization</span>
                {isMainCompanyAdmin ? (
                  <select value={form.organizationId || organization?.id || ""} onChange={(e) => setForm((f) => ({ ...f, organizationId: e.target.value, projectId: "" }))} className="field w-full">
                    {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
                  </select>
                ) : (
                  <div className="field w-full bg-surface-2 text-sm font-semibold text-ink">{organization?.name || "Current organization"}</div>
                )}
              </label>

              <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">Site name</span><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="field w-full" placeholder="DHA Construction Site" /></label>
              <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">Address</span><input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="field w-full" placeholder="Project address" /></label>

              <label className="block">
                <span className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-muted">
                  Linked project
                  <Link to="/projects" className="font-semibold text-accent hover:underline">
                    {projects.length ? "Manage projects" : "Create a project"}
                  </Link>
                </span>
                <select value={form.projectId} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))} className="field w-full">
                  <option value="">No project / permanent office</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.status}</option>)}
                </select>
                {selectedProject && <span className="mt-1 block text-[10px] text-muted-2">Employees in this project are automatically assigned to this site and must check in from inside it. Completed projects are excluded.</span>}
              </label>

              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted"><Clock3 size={12} /> Site time zone</span>
                <select value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} className="field w-full">
                  {TIMEZONE_GROUPS.map(([region, zones]) => (
                    <optgroup key={region} label={region}>
                      {zones.map((tz) => <option key={tz} value={tz}>{timezoneLabel(tz)}</option>)}
                    </optgroup>
                  ))}
                </select>
                <span className="mt-1 block text-[10px] text-muted-2">Attendance, breaks, late time and end-of-day calculations use this site's time zone.</span>
              </label>

              <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">Geofence mode</span><select value={form.geofenceMode} onChange={(e) => setForm((f) => ({ ...f, geofenceMode: e.target.value }))} className="field w-full"><option value="STRICT">Strict — outside check-in = Absent, blocks outside check-out</option><option value="WARNING">Standard — outside check-in = Absent, check-out flagged</option><option value="DISABLED">Disabled — check in from anywhere</option></select></label>

              <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">Radius fallback (m)</span><input type="number" min="25" max="5000" value={form.radiusMeters} onChange={(e) => setForm((f) => ({ ...f, radiusMeters: e.target.value }))} className="field w-full" /></label>
              <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">Outside grace (min)</span><input type="number" min="5" max="720" value={form.outsideGraceMinutes} onChange={(e) => setForm((f) => ({ ...f, outsideGraceMinutes: e.target.value }))} className="field w-full" /></label>
            </div>

            <div>
              <span className="mb-2 block text-xs font-semibold text-muted">Actual site boundary</span>
              <AttendanceSiteMap
                latitude={form.latitude}
                longitude={form.longitude}
                boundary={form.boundary}
                radiusMeters={form.radiusMeters}
                type={form.geofenceType}
                onChange={(next) => setForm((f) => ({ ...f, ...next, geofenceType: next.type }))}
              />
              {form.geofenceType === "POLYGON" && form.boundary.length < 4 && <p className="mt-1 text-[10px] text-chip-yellow-fg">Draw at least 4 points around the actual construction property.</p>}
            </div>

            {error && <div className="rounded-2xl bg-chip-pink-bg px-3 py-2 text-xs text-chip-pink-fg">{error}</div>}
            {editingId ? (
              <button onClick={() => update.mutate()} disabled={update.isPending || !form.name.trim() || !form.latitude || !form.longitude || (form.geofenceType === "POLYGON" && form.boundary.length < 4)} className="pill-accent flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-sm disabled:opacity-50 sm:w-auto"><Save size={14} /> {update.isPending ? "Saving…" : "Save changes"}</button>
            ) : (
              <button onClick={() => create.mutate()} disabled={create.isPending || !form.name.trim() || !form.latitude || !form.longitude || (form.geofenceType === "POLYGON" && form.boundary.length < 4)} className="pill-accent flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-sm disabled:opacity-50 sm:w-auto"><Save size={14} /> {create.isPending ? "Creating…" : "Create site"}</button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {isLoading && <p className="text-sm text-muted">Loading sites…</p>}
          {sites.map((site) => {
            const projectCompleted = String(site.projectStatus || "").toUpperCase() === "COMPLETED"
            const attendanceOpen = !!site.active && !projectCompleted
            return (
              <div key={site.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Building2 size={16} /> {site.name}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted"><MapPin size={12} /> {site.address || "No address"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${attendanceOpen ? "bg-chip-green-bg text-chip-green-fg" : "bg-surface-2 text-muted"}`}>{attendanceOpen ? "Attendance active" : projectCompleted ? "Project completed" : "Inactive"}</span>
                    <button type="button" onClick={() => startEditing(site)} title="Edit site" className="inline-flex items-center justify-center rounded-xl border border-border px-2.5 py-1.5 text-muted transition hover:bg-surface-2 hover:text-ink"><Pencil size={14} /></button>
                    <button type="button" onClick={() => { if (!remove.isPending && window.confirm(`Delete "${site.name}"? Existing attendance history will be preserved.`)) remove.mutate(site.id) }} disabled={remove.isPending} title="Delete site" className="inline-flex items-center justify-center rounded-xl border border-chip-pink-bg px-2.5 py-1.5 text-chip-pink-fg transition hover:bg-chip-pink-bg disabled:opacity-50"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-2xl bg-surface-2 p-3"><p className="text-[10px] uppercase tracking-wide text-muted">Geofence</p><p className="mt-1 text-xs font-semibold text-ink">{site.geofenceType === "POLYGON" ? `${Math.round(Number(site.areaSqMeters || 0)).toLocaleString()} m²` : `${site.radiusMeters}m radius`}</p></div>
                  <div className="rounded-2xl bg-surface-2 p-3"><p className="text-[10px] uppercase tracking-wide text-muted">Employees</p><p className="mt-1 flex items-center gap-1 text-xs font-semibold text-ink"><Users size={12} /> {site.employeeCount || 0}</p></div>
                  <div className="rounded-2xl bg-surface-2 p-3"><p className="text-[10px] uppercase tracking-wide text-muted">Project</p><p className="mt-1 text-xs font-semibold text-ink">{site.projectName || "Permanent site"}</p>{site.projectId && <Link to="/projects" className="mt-1 inline-block text-[10px] font-semibold text-accent hover:underline">Open project →</Link>}</div>
                  <div className="rounded-2xl bg-surface-2 p-3"><p className="text-[10px] uppercase tracking-wide text-muted">Time zone</p><p className="mt-1 text-xs font-semibold text-ink">{site.timezone || DEFAULT_TZ}</p></div>
                  <div className="rounded-2xl bg-surface-2 p-3"><p className="text-[10px] uppercase tracking-wide text-muted">Outside grace</p><p className="mt-1 text-xs font-semibold text-ink">{site.outsideGraceMinutes || 60} min</p></div>
                </div>
                <div className="mt-4">
                  <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted"><Users size={12} /> Employees on this site</p>
                  {(site.employees || []).length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {site.employees.map((emp) => (
                        <span key={emp.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink">
                          {emp.name}
                          {emp.viaProject && <span className="rounded-full bg-chip-green-bg px-1.5 text-[9px] font-semibold uppercase text-chip-green-fg">Project</span>}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-2">{site.projectId ? "No members in the linked project yet — add employees to the project to assign them here." : "No employees assigned yet. Link a project to assign its members."}</p>
                  )}
                  {(site.employees || []).length > 0 && <p className="mt-2 text-[10px] text-muted-2">These employees can only check in from inside this site. Work from home is disabled for them, and a check-in from outside is marked Absent with their location recorded.</p>}
                </div>
                <SiteAdminsSection site={site} canAssign={canAssignSiteAdmins} />
              </div>
            )
          })}
          {!isLoading && sites.length === 0 && <EmptyState title="No attendance sites yet" description="Create your first project or office site." />}
        </div>
      </div>
    </div>
  )
}
