import { useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Clock3, ListTodo, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import Avatar from "../components/ui/Avatar"
import { hasModuleAccess } from "../utils/roles"
import { useAuth } from "../context/AuthContext"
import useMarkNotificationsRead from "../hooks/useMarkNotificationsRead"

const STATUSES = { TODO: "To do", IN_PROGRESS: "In progress", BLOCKED: "Blocked", DONE: "Done" }
const PRIORITIES = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" }
const blank = { projectId: "", title: "", description: "", priority: "MEDIUM", assignedToId: "", dueDate: "", estimatedHours: "" }

export default function Tasks() {
  useMarkNotificationsRead("TASK")
  const { user } = useAuth(); const management = hasModuleAccess(user?.role, "tasks"); const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false); const [form, setForm] = useState(blank); const [search, setSearch] = useState("")
  const [formError, setFormError] = useState("")
  const [editingId, setEditingId] = useState(null); const [editForm, setEditForm] = useState(null); const [editError, setEditError] = useState("")
  const { data: tasks = [], isLoading } = useQuery({ queryKey: ["tasks", search], queryFn: () => api.get("/tasks", { params: { search: search || undefined } }).then(r => r.data) })
  const { data: projects = [], isLoading: projectsLoading } = useQuery({ queryKey: ["projects", "task-form"], queryFn: () => api.get("/projects").then(r => r.data), enabled: management })
  const { data: employees = [] } = useQuery({ queryKey: ["employees", "task-form"], queryFn: () => api.get("/employees", { params: { page: 1, pageSize: 100 } }).then(r => r.data?.data || r.data || []), enabled: management })
  const create = useMutation({ mutationFn: () => api.post("/tasks", { ...form, estimatedHours: Number(form.estimatedHours || 0), assignedToId: form.assignedToId || null, dueDate: form.dueDate || null }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); setForm(blank); setFormError(""); setShowForm(false) } })
  const update = useMutation({ mutationFn: ({ id, data }) => api.patch(`/tasks/${id}`, data), onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }) })
  const saveEdit = useMutation({
    mutationFn: ({ id, data }) => api.patch(`/tasks/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); setEditingId(null); setEditForm(null) },
    onError: err => setEditError(err.response?.data?.error || "Could not update task."),
  })
  const remove = useMutation({ mutationFn: id => api.delete(`/tasks/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }) })
  const statusStyle = s => s === "DONE" ? "bg-green-100 text-green-700" : s === "BLOCKED" ? "bg-red-100 text-red-700" : s === "IN_PROGRESS" ? "bg-blue-100 text-blue-700" : "bg-surface-2 text-muted"
  const startEdit = task => {
    setEditingId(task.id); setEditError("")
    setEditForm({
      title: task.title, description: task.description || "", priority: task.priority,
      projectId: task.project?.id || "", assignedToId: task.assignedTo?.id || "", dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
      estimatedHours: String(task.estimatedHours ?? ""), actualHours: String(task.actualHours ?? ""),
    })
  }
  const cancelEdit = () => { setEditingId(null); setEditForm(null); setEditError("") }
  return <div className="space-y-5">
    <PageHeader title="Tasks" subtitle="Turn projects into clear, trackable work." actions={management && <button onClick={() => setShowForm(v => !v)} className="pill-accent flex items-center gap-2 px-4 py-2.5 text-sm">{showForm ? <X size={15}/> : <Plus size={15}/>} {showForm ? "Cancel" : "Add task"}</button>} />
    {showForm && <form onSubmit={e => { e.preventDefault(); if (!form.title.trim()) { setFormError("Task title is required."); return } setFormError(""); create.mutate() }} className="card grid gap-4 p-5 sm:grid-cols-2">
      <label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Project (optional)</span><select className="field mt-1 w-full" value={form.projectId} onChange={e => setForm({...form, projectId:e.target.value})}><option value="">No project — assign directly</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>{!projectsLoading && projects.length === 0 && <p className="mt-1 text-[11px] text-muted">No projects yet — you can still create tasks without one, or create a project first on the <Link to="/projects" className="underline">Projects page</Link>.</p>}</label>
      <label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Task title</span><input className="field mt-1 w-full" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Prepare API integration"/></label>
      <label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Description</span><textarea className="field mt-1 w-full" rows="3" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      <label><span className="text-xs font-semibold text-muted">Assignee</span><select className="field mt-1 w-full" value={form.assignedToId} onChange={e=>setForm({...form,assignedToId:e.target.value})}><option value="">Unassigned</option>{employees.filter(e=>e.status!=="LEFT_COMPANY").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label><span className="text-xs font-semibold text-muted">Priority</span><select className="field mt-1 w-full" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}>{Object.entries(PRIORITIES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label><span className="text-xs font-semibold text-muted">Due date</span><input type="date" className="field mt-1 w-full" value={form.dueDate} onChange={e=>setForm({...form,dueDate:e.target.value})}/></label>
      <label><span className="text-xs font-semibold text-muted">Estimated hours</span><input type="number" min="0" step="0.25" className="field mt-1 w-full" value={form.estimatedHours} onChange={e=>setForm({...form,estimatedHours:e.target.value})}/></label>
      <div className="sm:col-span-2 flex justify-end"><button disabled={create.isPending} className="pill-accent px-5 py-2.5 text-sm">{create.isPending ? "Creating…" : "Create task"}</button></div>
      {formError && <p className="sm:col-span-2 text-xs text-danger">{formError}</p>}
      {create.isError && <p className="sm:col-span-2 text-xs text-danger">{create.error?.response?.data?.error || "Could not create task."}</p>}
    </form>}
    <div className="card p-4"><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"/><input className="field w-full pl-9" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search tasks…"/></div></div>
    {isLoading ? <div className="card p-8 text-center text-sm text-muted">Loading tasks…</div> : <div className="grid gap-4 lg:grid-cols-2">{tasks.map(task => {
      const editing = editingId === task.id
      return <div key={task.id} className="card p-5">
        {editing ? <form onSubmit={e => { e.preventDefault(); saveEdit.mutate({ id: task.id, data: { ...editForm, estimatedHours: Number(editForm.estimatedHours || 0), actualHours: Number(editForm.actualHours || 0), projectId: editForm.projectId || null, assignedToId: editForm.assignedToId || null, dueDate: editForm.dueDate || null } }) }} className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Task title</span><input className="field mt-1 w-full" value={editForm.title} onChange={e=>setEditForm({...editForm,title:e.target.value})}/></label>
          <label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Description</span><textarea className="field mt-1 w-full" rows="3" value={editForm.description} onChange={e=>setEditForm({...editForm,description:e.target.value})}/></label>
          <label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Project (optional)</span><select className="field mt-1 w-full" value={editForm.projectId} onChange={e=>setEditForm({...editForm,projectId:e.target.value})}><option value="">No project — assign directly</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label><span className="text-xs font-semibold text-muted">Assignee</span><select className="field mt-1 w-full" value={editForm.assignedToId} onChange={e=>setEditForm({...editForm,assignedToId:e.target.value})}><option value="">Unassigned</option>{employees.filter(e=>e.status!=="LEFT_COMPANY").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label><span className="text-xs font-semibold text-muted">Priority</span><select className="field mt-1 w-full" value={editForm.priority} onChange={e=>setEditForm({...editForm,priority:e.target.value})}>{Object.entries(PRIORITIES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
          <label><span className="text-xs font-semibold text-muted">Due date</span><input type="date" className="field mt-1 w-full" value={editForm.dueDate} onChange={e=>setEditForm({...editForm,dueDate:e.target.value})}/></label>
          <label><span className="text-xs font-semibold text-muted">Estimated hours</span><input type="number" min="0" step="0.25" className="field mt-1 w-full" value={editForm.estimatedHours} onChange={e=>setEditForm({...editForm,estimatedHours:e.target.value})}/></label>
          <label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Actual hours</span><input type="number" min="0" step="0.25" className="field mt-1 w-full" value={editForm.actualHours} onChange={e=>setEditForm({...editForm,actualHours:e.target.value})}/></label>
          <div className="sm:col-span-2 flex justify-end gap-2"><button type="button" onClick={cancelEdit} className="rounded-2xl bg-surface-2 px-4 py-2.5 text-xs">Cancel</button><button disabled={saveEdit.isPending} className="pill-accent px-5 py-2.5 text-sm">{saveEdit.isPending?"Saving…":"Save changes"}</button></div>
          {editError && <p className="sm:col-span-2 text-xs text-danger">{editError}</p>}
        </form> : <>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold text-ink">{task.title}</p><p className="mt-1 text-xs text-muted">{task.project?.name || "No project"}</p></div>{management && <div className="flex gap-1"><button onClick={()=>startEdit(task)} className="rounded-full p-2 text-muted hover:bg-surface-2" aria-label="Edit task" title="Edit task"><Pencil size={14}/></button><button onClick={()=>{if(window.confirm("Delete this task?")) remove.mutate(task.id)}} className="rounded-full p-2 text-muted hover:bg-red-50 hover:text-danger" aria-label="Delete task" title="Delete task"><Trash2 size={14}/></button></div>}</div>
          <div className="mt-4 flex flex-wrap gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusStyle(task.status)}`}>{STATUSES[task.status]}</span><span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-semibold text-muted">{PRIORITIES[task.priority]}</span>{task.dueDate && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] text-muted">Due {new Date(task.dueDate).toLocaleDateString()}</span>}</div>
          {task.description && <p className="mt-3 text-xs leading-5 text-muted">{task.description}</p>}
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3"><div className="flex items-center gap-2">{task.assignedTo ? <><Avatar name={task.assignedTo.name} src={task.assignedTo.photoUrl} size="xs"/><span className="text-xs text-muted">{task.assignedTo.name}</span></> : <span className="text-xs text-muted">Unassigned</span>}</div><div className="text-right text-[10px] text-muted">{Number(task.actualHours||0).toFixed(2)} / {Number(task.estimatedHours||0).toFixed(2)} h</div></div>
          <div className="mt-3 flex items-center gap-2"><select value={task.status} onChange={e=>update.mutate({id:task.id,data:{status:e.target.value}})} className="field flex-1 py-2 text-xs">{Object.entries(STATUSES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><Clock3 size={15} className="text-muted"/></div>
        </>}
      </div>
    })}{tasks.length===0 && <div className="card p-8 text-center text-sm text-muted lg:col-span-2">No tasks found.</div>}</div>}
  </div>
}
