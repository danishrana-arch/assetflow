import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Award, Pencil, Plus, Trash2, X } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import { hasModuleAccess } from "../utils/roles"
import { useAuth } from "../context/AuthContext"

const blankForm = { employeeId: "", periodStart: "", periodEnd: "", rating: 5, goals: "", achievements: "", feedback: "" }

export default function Performance(){
 const {user}=useAuth(); const management=hasModuleAccess(user?.role, "performance"); const qc=useQueryClient(); const [show,setShow]=useState(false)
 const [form,setForm]=useState(blankForm)
 const [editingId,setEditingId]=useState(null)
 const [editForm,setEditForm]=useState(null)
 const {data:reviews=[]}=useQuery({queryKey:["performance"],queryFn:()=>api.get("/performance").then(r=>r.data)})
 const {data:employees=[]}=useQuery({queryKey:["employees","performance"],queryFn:()=>api.get("/employees",{params:{page:1,pageSize:100}}).then(r=>r.data?.data||[]),enabled:management})
 const create=useMutation({mutationFn:()=>api.post("/performance",form),onSuccess:()=>{qc.invalidateQueries({queryKey:["performance"]});setShow(false);setForm(blankForm)}})
 const update=useMutation({mutationFn:({id,data})=>api.patch(`/performance/${id}`,data),onSuccess:()=>{qc.invalidateQueries({queryKey:["performance"]});setEditingId(null);setEditForm(null)}})
 const remove=useMutation({mutationFn:id=>api.delete(`/performance/${id}`),onSuccess:()=>qc.invalidateQueries({queryKey:["performance"]})})
 const stars=n=>"★".repeat(Math.round(n))+"☆".repeat(5-Math.round(n))
 const startEdit=r=>{setEditingId(r.id);setEditForm({periodStart:r.periodStart.slice(0,10),periodEnd:r.periodEnd.slice(0,10),rating:r.rating,goals:r.goals||"",achievements:r.achievements||"",feedback:r.feedback||""})}
 const cancelEdit=()=>{setEditingId(null);setEditForm(null)}
 return <div className="space-y-5"><PageHeader title="Performance" subtitle="Keep a structured history of goals, achievements and manager feedback." actions={management&&<button onClick={()=>setShow(v=>!v)} className="pill-accent flex items-center gap-2 px-4 py-2.5 text-sm">{show?<X size={15}/>:<Plus size={15}/>} {show?"Cancel":"Add review"}</button>}/>
 {show&&<form onSubmit={e=>{e.preventDefault();create.mutate()}} className="card grid gap-4 p-5 sm:grid-cols-2"><label><span className="text-xs font-semibold text-muted">Employee</span><select required className="field mt-1 w-full" value={form.employeeId} onChange={e=>setForm({...form,employeeId:e.target.value})}><option value="">Select employee</option>{employees.filter(e=>e.status!=="LEFT_COMPANY").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label><span className="text-xs font-semibold text-muted">Rating</span><select className="field mt-1 w-full" value={form.rating} onChange={e=>setForm({...form,rating:Number(e.target.value)})}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}/5</option>)}</select></label><label><span className="text-xs font-semibold text-muted">Period start</span><input required type="date" className="field mt-1 w-full" value={form.periodStart} onChange={e=>setForm({...form,periodStart:e.target.value})}/></label><label><span className="text-xs font-semibold text-muted">Period end</span><input required type="date" className="field mt-1 w-full" value={form.periodEnd} onChange={e=>setForm({...form,periodEnd:e.target.value})}/></label><label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Goals</span><textarea className="field mt-1 w-full" rows="2" value={form.goals} onChange={e=>setForm({...form,goals:e.target.value})}/></label><label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Achievements</span><textarea className="field mt-1 w-full" rows="2" value={form.achievements} onChange={e=>setForm({...form,achievements:e.target.value})}/></label><label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Feedback</span><textarea className="field mt-1 w-full" rows="3" value={form.feedback} onChange={e=>setForm({...form,feedback:e.target.value})}/></label><div className="sm:col-span-2 flex justify-end"><button disabled={create.isPending} className="pill-accent px-5 py-2.5 text-sm">{create.isPending?"Saving…":"Publish review"}</button></div>{create.isError&&<p className="sm:col-span-2 text-xs text-danger">{create.error?.response?.data?.error||"Could not save review."}</p>}</form>}
 <div className="grid gap-4 lg:grid-cols-2">{reviews.map(r=>{
   const editing=editingId===r.id
   return <article key={r.id} className="card p-5">
     {editing?<form onSubmit={e=>{e.preventDefault();update.mutate({id:r.id,data:editForm})}} className="grid gap-3 sm:grid-cols-2">
       <label><span className="text-xs font-semibold text-muted">Rating</span><select className="field mt-1 w-full" value={editForm.rating} onChange={e=>setEditForm({...editForm,rating:Number(e.target.value)})}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}/5</option>)}</select></label>
       <div/>
       <label><span className="text-xs font-semibold text-muted">Period start</span><input required type="date" className="field mt-1 w-full" value={editForm.periodStart} onChange={e=>setEditForm({...editForm,periodStart:e.target.value})}/></label>
       <label><span className="text-xs font-semibold text-muted">Period end</span><input required type="date" className="field mt-1 w-full" value={editForm.periodEnd} onChange={e=>setEditForm({...editForm,periodEnd:e.target.value})}/></label>
       <label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Goals</span><textarea className="field mt-1 w-full" rows="2" value={editForm.goals} onChange={e=>setEditForm({...editForm,goals:e.target.value})}/></label>
       <label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Achievements</span><textarea className="field mt-1 w-full" rows="2" value={editForm.achievements} onChange={e=>setEditForm({...editForm,achievements:e.target.value})}/></label>
       <label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Feedback</span><textarea className="field mt-1 w-full" rows="3" value={editForm.feedback} onChange={e=>setEditForm({...editForm,feedback:e.target.value})}/></label>
       <div className="sm:col-span-2 flex justify-end gap-2"><button type="button" onClick={cancelEdit} className="rounded-2xl bg-surface-2 px-4 py-2.5 text-xs">Cancel</button><button disabled={update.isPending} className="pill-accent px-5 py-2.5 text-sm">{update.isPending?"Saving…":"Save changes"}</button></div>
       {update.isError&&<p className="sm:col-span-2 text-xs text-danger">{update.error?.response?.data?.error||"Could not update review."}</p>}
     </form>:<>
       <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-ink">{r.employee?.name}</p><p className="mt-1 text-xs text-muted">{r.employee?.department?.name||"No department"} · Reviewed by {r.reviewer?.name}</p></div><div className="flex items-start gap-2"><div className="text-right"><p className="text-lg tracking-wider text-ink">{stars(r.rating)}</p><p className="text-[10px] text-muted">{r.rating}/5</p></div>{management&&<div className="flex gap-1"><button onClick={()=>startEdit(r)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-2" aria-label="Edit review" title="Edit review"><Pencil size={13}/></button><button onClick={()=>{if(window.confirm("Delete this performance review? This cannot be undone.")) remove.mutate(r.id)}} className="flex h-8 w-8 items-center justify-center rounded-full text-danger hover:bg-chip-pink-bg" aria-label="Delete review" title="Delete review"><Trash2 size={13}/></button></div>}</div></div>
       <p className="mt-4 text-[11px] text-muted">{new Date(r.periodStart).toLocaleDateString()} – {new Date(r.periodEnd).toLocaleDateString()}</p>
       {r.goals&&<div className="mt-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Goals</p><p className="mt-1 text-sm leading-6 text-muted">{r.goals}</p></div>}
       {r.achievements&&<div className="mt-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Achievements</p><p className="mt-1 text-sm leading-6 text-muted">{r.achievements}</p></div>}
       {r.feedback&&<div className="mt-4 rounded-2xl bg-surface-2 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Manager feedback</p><p className="mt-1 text-sm leading-6 text-muted">{r.feedback}</p></div>}
     </>}
   </article>
 })}{reviews.length===0&&<div className="card p-10 text-center text-sm text-muted lg:col-span-2"><Award className="mx-auto mb-2" size={22}/>No performance reviews yet.</div>}</div></div>
}
