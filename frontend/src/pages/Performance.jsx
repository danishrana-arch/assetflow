import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Award, CheckCircle2, Gift, Minus, Pencil, Plus, Trash2, X } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import { hasModuleAccess } from "../utils/roles"
import { useAuth } from "../context/AuthContext"

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"]
const MIN_BONUS = 500
const pkr = n => `PKR ${Number(n||0).toLocaleString("en-US",{maximumFractionDigits:2})}`
const currentMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}` }
const blankForm = () => ({ employeeId: "", month: currentMonth(), rating: 5, goals: "", achievements: "", feedback: "", bonusAmount: 0 })
// periodStart is the 1st of the review month (UTC date).
const monthOf = r => String(r.periodStart).slice(0,7)
const monthLabel = key => { const [y,m]=key.split("-").map(Number); return `${MONTHS[m-1]} ${y}` }

// Performance bonus input: 0 or at least PKR 500, in steps of 500 (same
// rule as a payslip bonus). It goes straight onto the review month's
// payslip — see performance.controller.js.
function BonusField({value,onChange,month}){
 const n=Number(value)||0
 const step=d=>{const next=n+d; onChange(next<MIN_BONUS?(d<0?0:MIN_BONUS):next)}
 const invalid=n<0||(n>0&&n<MIN_BONUS)
 return <label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Performance bonus (PKR)</span>
  <div className="mt-1 flex items-center gap-2"><button type="button" disabled={n===0} onClick={()=>step(-MIN_BONUS)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-ink disabled:opacity-40" aria-label="Decrease bonus"><Minus size={14}/></button><input type="number" min="0" step={MIN_BONUS} className="field w-full" value={value} onChange={e=>onChange(e.target.value===""?"":Number(e.target.value))}/><button type="button" onClick={()=>step(MIN_BONUS)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-ink" aria-label="Increase bonus"><Plus size={14}/></button></div>
  <p className={`mt-1 text-[11px] ${invalid?"text-danger":"text-muted"}`}>{invalid?`Bonus must be 0 or at least ${pkr(MIN_BONUS)}.`:`0 for no bonus. It's added directly to the employee's ${month?monthLabel(month):"review month"} payslip (created as a draft if it doesn't exist yet; the next open month if that one is already submitted or paid).`}</p></label>
}

function MonthField({value,onChange}){
 return <label><span className="text-xs font-semibold text-muted">Review month</span><input required type="month" className="field mt-1 w-full" value={value} onChange={e=>onChange(e.target.value)}/></label>
}

// Where the bonus landed, from the API's `payslip` field.
function payslipMessage(p,amount){
 if(!p) return null
 if(!p.status) return `Bonus of ${pkr(amount)} saved for ${p.label}. The employee has no base salary yet, so it will be added when their payslip is generated.`
 return `Bonus of ${pkr(amount)} added to the ${p.label} payslip${p.created?" (new draft payslip created)":""}. Net pay is now ${pkr(p.netPay)}.`
}

export default function Performance(){
 const {user}=useAuth(); const management=hasModuleAccess(user?.role, "performance"); const canAwardBonus=hasModuleAccess(user?.role, "payroll"); const qc=useQueryClient(); const [show,setShow]=useState(false)
 const [form,setForm]=useState(blankForm)
 const [editingId,setEditingId]=useState(null)
 const [editForm,setEditForm]=useState(null)
 const [notice,setNotice]=useState("")
 const {data:reviews=[]}=useQuery({queryKey:["performance"],queryFn:()=>api.get("/performance").then(r=>r.data)})
 const {data:employees=[]}=useQuery({queryKey:["employees","performance"],queryFn:()=>api.get("/employees",{params:{page:1,pageSize:100}}).then(r=>r.data?.data||[]),enabled:management})
 const withBonus=data=>{const {bonusAmount,...rest}=data;return canAwardBonus?{...rest,bonusAmount:Number(bonusAmount)||0}:rest}
 const refresh=()=>{qc.invalidateQueries({queryKey:["performance"]});qc.invalidateQueries({queryKey:["payroll"]})}
 const create=useMutation({mutationFn:()=>api.post("/performance",withBonus(form)).then(r=>r.data),onSuccess:data=>{refresh();setShow(false);setForm(blankForm());setNotice(payslipMessage(data.payslip,data.bonusAmount)||"Review published.")}})
 const update=useMutation({mutationFn:({id,data})=>api.patch(`/performance/${id}`,data).then(r=>r.data),onSuccess:data=>{refresh();setEditingId(null);setEditForm(null);setNotice(data.payslip?payslipMessage(data.payslip,data.bonusAmount):"Review updated.")}})
 const remove=useMutation({mutationFn:id=>api.delete(`/performance/${id}`),onSuccess:()=>{refresh();setNotice("Review deleted.")}})
 const stars=n=>"★".repeat(Math.round(n))+"☆".repeat(5-Math.round(n))
 const startEdit=r=>{setNotice("");setEditingId(r.id);setEditForm({month:monthOf(r),rating:r.rating,goals:r.goals||"",achievements:r.achievements||"",feedback:r.feedback||"",bonusAmount:r.bonusAmount||0})}
 const cancelEdit=()=>{setEditingId(null);setEditForm(null)}
 return <div className="space-y-5"><PageHeader title="Performance" subtitle="A monthly record of each employee's goals, achievements, manager feedback and bonus." actions={management&&<button onClick={()=>{setShow(v=>!v);setNotice("")}} className="pill-accent flex items-center gap-2 px-4 py-2.5 text-sm">{show?<X size={15}/>:<Plus size={15}/>} {show?"Cancel":"Add review"}</button>}/>
 {notice&&<div className="flex items-start justify-between gap-3 rounded-2xl bg-emerald-500/10 px-4 py-3 text-xs font-medium text-emerald-700"><span className="flex items-start gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0"/>{notice}</span><button onClick={()=>setNotice("")} aria-label="Dismiss"><X size={14}/></button></div>}
 {show&&<form onSubmit={e=>{e.preventDefault();create.mutate()}} className="card grid gap-4 p-5 sm:grid-cols-2"><label><span className="text-xs font-semibold text-muted">Employee</span><select required className="field mt-1 w-full" value={form.employeeId} onChange={e=>setForm({...form,employeeId:e.target.value})}><option value="">Select employee</option>{employees.filter(e=>e.status!=="LEFT_COMPANY").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><MonthField value={form.month} onChange={v=>setForm({...form,month:v})}/><label><span className="text-xs font-semibold text-muted">Rating</span><select className="field mt-1 w-full" value={form.rating} onChange={e=>setForm({...form,rating:Number(e.target.value)})}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}/5</option>)}</select></label><div/><label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Goals</span><textarea className="field mt-1 w-full" rows="2" value={form.goals} onChange={e=>setForm({...form,goals:e.target.value})}/></label><label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Achievements</span><textarea className="field mt-1 w-full" rows="2" value={form.achievements} onChange={e=>setForm({...form,achievements:e.target.value})}/></label><label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Feedback</span><textarea className="field mt-1 w-full" rows="3" value={form.feedback} onChange={e=>setForm({...form,feedback:e.target.value})}/></label>{canAwardBonus&&<BonusField value={form.bonusAmount} month={form.month} onChange={v=>setForm({...form,bonusAmount:v})}/>}<div className="sm:col-span-2 flex justify-end"><button disabled={create.isPending} className="pill-accent px-5 py-2.5 text-sm">{create.isPending?"Saving…":"Publish review"}</button></div>{create.isError&&<p className="sm:col-span-2 text-xs text-danger">{create.error?.response?.data?.error||"Could not save review."}</p>}</form>}
 <div className="grid gap-4 lg:grid-cols-2">{reviews.map(r=>{
   const editing=editingId===r.id
   return <article key={r.id} className="card p-5">
     {editing?<form onSubmit={e=>{e.preventDefault();update.mutate({id:r.id,data:withBonus(editForm)})}} className="grid gap-3 sm:grid-cols-2">
       <MonthField value={editForm.month} onChange={v=>setEditForm({...editForm,month:v})}/>
       <label><span className="text-xs font-semibold text-muted">Rating</span><select className="field mt-1 w-full" value={editForm.rating} onChange={e=>setEditForm({...editForm,rating:Number(e.target.value)})}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}/5</option>)}</select></label>
       <label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Goals</span><textarea className="field mt-1 w-full" rows="2" value={editForm.goals} onChange={e=>setEditForm({...editForm,goals:e.target.value})}/></label>
       <label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Achievements</span><textarea className="field mt-1 w-full" rows="2" value={editForm.achievements} onChange={e=>setEditForm({...editForm,achievements:e.target.value})}/></label>
       <label className="sm:col-span-2"><span className="text-xs font-semibold text-muted">Feedback</span><textarea className="field mt-1 w-full" rows="3" value={editForm.feedback} onChange={e=>setEditForm({...editForm,feedback:e.target.value})}/></label>
       {canAwardBonus&&<BonusField value={editForm.bonusAmount} month={editForm.month} onChange={v=>setEditForm({...editForm,bonusAmount:v})}/>}
       <div className="sm:col-span-2 flex justify-end gap-2"><button type="button" onClick={cancelEdit} className="rounded-2xl bg-surface-2 px-4 py-2.5 text-xs">Cancel</button><button disabled={update.isPending} className="pill-accent px-5 py-2.5 text-sm">{update.isPending?"Saving…":"Save changes"}</button></div>
       {update.isError&&<p className="sm:col-span-2 text-xs text-danger">{update.error?.response?.data?.error||"Could not update review."}</p>}
     </form>:<>
       <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-ink">{r.employee?.name}</p><p className="mt-1 text-xs text-muted">{r.employee?.department?.name||"No department"} · Reviewed by {r.reviewer?.name}</p></div><div className="flex items-start gap-2"><div className="text-right"><p className="text-lg tracking-wider text-ink">{stars(r.rating)}</p><p className="text-[10px] text-muted">{r.rating}/5</p></div>{management&&<div className="flex gap-1"><button onClick={()=>startEdit(r)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-2" aria-label="Edit review" title="Edit review"><Pencil size={13}/></button><button onClick={()=>{if(window.confirm(r.bonusAmount>0?"Delete this performance review? Its bonus will be removed from the payslip if that payslip is still a draft.":"Delete this performance review? This cannot be undone.")) remove.mutate(r.id)}} className="flex h-8 w-8 items-center justify-center rounded-full text-danger hover:bg-chip-pink-bg" aria-label="Delete review" title="Delete review"><Trash2 size={13}/></button></div>}</div></div>
       <p className="mt-4 text-[11px] font-semibold text-muted">{monthLabel(monthOf(r))} review</p>
       {r.bonusAmount>0&&<div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-700"><Gift size={13}/>Bonus {pkr(r.bonusAmount)}{r.bonusPayrollMonth&&<span className="font-normal">· on {MONTHS[r.bonusPayrollMonth-1]} {r.bonusPayrollYear} payslip</span>}</div>}
       {r.goals&&<div className="mt-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Goals</p><p className="mt-1 text-sm leading-6 text-muted">{r.goals}</p></div>}
       {r.achievements&&<div className="mt-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Achievements</p><p className="mt-1 text-sm leading-6 text-muted">{r.achievements}</p></div>}
       {r.feedback&&<div className="mt-4 rounded-2xl bg-surface-2 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Manager feedback</p><p className="mt-1 text-sm leading-6 text-muted">{r.feedback}</p></div>}
     </>}
   </article>
 })}{reviews.length===0&&<div className="card p-10 text-center text-sm text-muted lg:col-span-2"><Award className="mx-auto mb-2" size={22}/>No performance reviews yet.</div>}</div></div>
}
