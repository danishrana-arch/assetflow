import { useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, X, Building2, Users, Boxes, UserRound, Pencil, Trash2, Check, ChevronDown, ChevronUp, Search } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { hasModuleAccess } from "../utils/roles"
import PageHeader from "../components/ui/PageHeader"
import IconChip from "../components/ui/IconChip"
import { TextField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

const TONES = ["blue", "purple", "cyan", "orange", "green", "pink", "yellow"]

function ManagerSelect({ value, onChange, employees, className = "field mt-1 w-full" }) {
  return (
    <select className={className} value={value} onChange={onChange}>
      <option value="">No manager assigned</option>
      {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
    </select>
  )
}

// Members of one department, loaded only when its card is expanded.
function DepartmentMembers({ departmentId }) {
  const { data: members = [], isLoading } = useQuery({
    queryKey: ["employees", "department", departmentId],
    queryFn: () => api.get("/employees", { params: { department: departmentId, page: 1, pageSize: 100 } }).then((r) => r.data?.data || []),
  })
  if (isLoading) return <p className="mt-3 text-xs text-muted">Loading…</p>
  if (!members.length) return <p className="mt-3 text-xs text-muted">No employees in this department.</p>
  return (
    <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto">
      {members.map((m) => (
        <li key={m.id}>
          <Link to={`/employees/${m.id}`} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-xs hover:text-accent">
            <span className="truncate font-medium text-ink">{m.name}</span>
            <span className="ml-2 shrink-0 text-muted">{m.designation || m.role}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default function Departments() {
  const { user } = useAuth()
  const qc = useQueryClient()
  // Creating/renaming/reassigning departments is org-structure work —
  // ADMIN/CEO only. A DEPARTMENT_HEAD reaching this page only ever gets
  // their own department back from the API and can just view it.
  const canEdit = ["ADMIN", "CEO"].includes(user?.role)
  const canViewMembers = hasModuleAccess(user?.role, "employees")

  const [showForm, setShowForm] = useState(false)
  const [newDept, setNewDept] = useState({ name: "", managerId: "" })
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState({ name: "", managerId: "" })
  const [expandedId, setExpandedId] = useState(null)
  const [search, setSearch] = useState("")
  const [error, setError] = useState("")

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get("/departments").then((r) => r.data),
  })
  // Manager options — needed by the create form and every card's editor,
  // so load them whenever the viewer can edit (previously only while the
  // create form was open, which left the card dropdowns empty).
  const { data: employees = [] } = useQuery({
    queryKey: ["employees", "department-managers"],
    queryFn: () => api.get("/employees", { params: { page: 1, pageSize: 100 } }).then((r) => r.data?.data || []),
    enabled: canEdit,
  })
  const managerOptions = employees.filter((e) => e.status !== "LEFT_COMPANY")

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["departments"] })
    qc.invalidateQueries({ queryKey: ["employees"] })
  }
  const onError = (fallback) => (e) => setError(e.response?.data?.error || fallback)

  const create = useMutation({
    mutationFn: () => api.post("/departments", { name: newDept.name.trim(), managerId: newDept.managerId || null }),
    onSuccess: () => { refresh(); setShowForm(false); setNewDept({ name: "", managerId: "" }); setError("") },
    onError: onError("Could not create department"),
  })
  const update = useMutation({
    mutationFn: ({ id, data }) => api.patch(`/departments/${id}`, data),
    onSuccess: () => { refresh(); setEditingId(null); setError("") },
    onError: onError("Could not update department"),
  })
  const remove = useMutation({
    mutationFn: (id) => api.delete(`/departments/${id}`),
    onSuccess: () => { refresh(); setError("") },
    onError: onError("Could not delete department"),
  })

  function startEdit(dept) {
    setEditingId(dept.id)
    setEditDraft({ name: dept.name, managerId: dept.manager?.id || "" })
    setError("")
  }

  function handleDelete(dept) {
    const people = dept._count?.employees || 0
    const assets = dept._count?.assets || 0
    const impact = people || assets
      ? `\n\n${people} employee${people === 1 ? "" : "s"} and ${assets} asset${assets === 1 ? "" : "s"} will be left without a department. They are not deleted.`
      : ""
    if (window.confirm(`Delete the "${dept.name}" department?${impact}`)) remove.mutate(dept.id)
  }

  const term = search.trim().toLowerCase()
  const visible = term ? departments.filter((d) => d.name.toLowerCase().includes(term)) : departments

  return (
    <div>
      <PageHeader
        backTo="/"
        title="Departments"
        subtitle="Organize people, assets and ownership by team."
        actions={canEdit ? (
          <button onClick={() => { setShowForm((v) => !v); setError("") }} className="pill-accent flex items-center gap-1.5 px-4 py-2.5 text-sm">
            {showForm ? <X size={15} /> : <Plus size={15} />} {showForm ? "Cancel" : "Add Department"}
          </button>
        ) : null}
      />

      {showForm && canEdit && (
        <form onSubmit={(e) => { e.preventDefault(); if (newDept.name.trim()) create.mutate() }} className="card mb-5 grid gap-3 p-5 sm:grid-cols-2">
          <TextField label="Department name" value={newDept.name} onChange={(e) => setNewDept((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Engineering" required />
          <label>
            <span className="text-xs font-medium text-muted">Department manager</span>
            <ManagerSelect value={newDept.managerId} onChange={(e) => setNewDept((d) => ({ ...d, managerId: e.target.value }))} employees={managerOptions} />
          </label>
          <div className="flex justify-end sm:col-span-2">
            <button type="submit" disabled={create.isPending || !newDept.name.trim()} className="pill-accent px-5 py-2.5 text-sm disabled:opacity-50">{create.isPending ? "Creating…" : "Create"}</button>
          </div>
        </form>
      )}

      {error && <div className="mb-4 rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">{error}</div>}

      {departments.length > 3 && (
        <div className="relative mb-4 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search departments" className="field w-full pl-9" />
        </div>
      )}

      {isLoading ? <p className="text-sm text-muted">Loading…</p> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((dept, i) => {
            const editing = editingId === dept.id
            const expanded = expandedId === dept.id
            return (
              <div key={dept.id} className="card p-5">
                <div className="flex items-start justify-between">
                  <IconChip icon={Building2} tone={TONES[i % TONES.length]} size="md" />
                  {canEdit && !editing && (
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(dept)} title="Edit department" aria-label="Edit department" className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-ink"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(dept)} disabled={remove.isPending} title="Delete department" aria-label="Delete department" className="rounded-full p-2 text-muted hover:bg-red-50 hover:text-danger disabled:opacity-50"><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>

                {editing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (editDraft.name.trim()) update.mutate({ id: dept.id, data: { name: editDraft.name.trim(), managerId: editDraft.managerId || null } })
                    }}
                    className="mt-4 space-y-3"
                  >
                    <TextField label="Department name" value={editDraft.name} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} required />
                    <label className="block">
                      <span className="text-xs font-medium text-muted">Department manager</span>
                      <ManagerSelect value={editDraft.managerId} onChange={(e) => setEditDraft((d) => ({ ...d, managerId: e.target.value }))} employees={managerOptions} />
                    </label>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setEditingId(null)} className="pill-secondary flex items-center gap-1 px-3 py-1.5 text-xs"><X size={12} /> Cancel</button>
                      <button type="submit" disabled={update.isPending || !editDraft.name.trim()} className="pill-accent flex items-center gap-1 px-3 py-1.5 text-xs disabled:opacity-50"><Check size={12} /> {update.isPending ? "Saving…" : "Save"}</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className="mt-4 text-lg font-semibold text-ink">{dept.name}</p>
                    <div className="mt-4 flex items-center gap-4 text-xs text-muted">
                      <span className="inline-flex items-center gap-1.5"><Users size={12} /> {dept._count?.employees || 0} employees</span>
                      <span className="inline-flex items-center gap-1.5"><Boxes size={12} /> {dept._count?.assets || 0} assets</span>
                    </div>
                    <div className="mt-4 border-t border-border pt-4">
                      <div className="flex items-center gap-2">
                        <UserRound size={14} className="text-muted" />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Manager</span>
                      </div>
                      <p className="mt-2 text-xs text-ink">{dept.manager?.name || <span className="text-muted">No manager</span>}</p>
                    </div>
                    {canViewMembers && (
                      <div className="mt-4 border-t border-border pt-3">
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : dept.id)}
                          className="flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted hover:text-ink"
                        >
                          {expanded ? "Hide employees" : "View employees"}
                          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        {expanded && <DepartmentMembers departmentId={dept.id} />}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
          {departments.length === 0 && (
            <div className="sm:col-span-2 lg:col-span-3">
              <EmptyState icon={Building2} title="No departments yet" description={canEdit ? "Create departments to organize employees and assets." : "No departments have been set up."} />
            </div>
          )}
          {departments.length > 0 && visible.length === 0 && (
            <p className="text-sm text-muted sm:col-span-2 lg:col-span-3">No departments match "{search}".</p>
          )}
        </div>
      )}
    </div>
  )
}
