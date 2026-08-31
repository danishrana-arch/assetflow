import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Megaphone, Trash2, Plus } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import { TextField, SelectField } from "../components/ui/Field"

export default function Announcements(){
 const {user}=useAuth(), qc=useQueryClient(), management=["ADMIN","CEO"].includes(user?.role)
 const [title,setTitle]=useState(""),[body,setBody]=useState(""),[audienceType,setAudienceType]=useState("ALL"),[audienceId,setAudienceId]=useState("")
 const {data:rows=[]}=useQuery({queryKey:["announcements"],queryFn:()=>api.get("/dashboard/announcements").then(r=>r.data)})
 const {data:departments=[]}=useQuery({queryKey:["departments"],queryFn:()=>api.get("/departments").then(r=>r.data),enabled:management})
 const create=useMutation({mutationFn:()=>api.post("/dashboard/announcements",{title,body,audienceType,audienceId:audienceType==="DEPARTMENT"?audienceId:null}),onSuccess:()=>{setTitle("");setBody("");setAudienceId("");qc.invalidateQueries({queryKey:["announcements"]})}})
 const remove=useMutation({mutationFn:id=>api.delete(`/dashboard/announcements/${id}`),onSuccess:()=>qc.invalidateQueries({queryKey:["announcements"]})})
 return <div className="space-y-5"><PageHeader title="Company Announcements" subtitle="Keep employees informed about company-wide and department updates." actions={management&&<span className="pill-accent flex items-center gap-1.5 px-3 py-2 text-xs"><Megaphone size={14}/> Management publishing</span>}/>
  {management&&<div className="card p-5"><SectionHeader title="Publish announcement"/><form className="mt-4 space-y-4" onSubmit={e=>{e.preventDefault();if(title.trim()&&body.trim()&&(audienceType!=="DEPARTMENT"||audienceId))create.mutate()}}><TextField label="Title" value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Office closed Friday"/><div><label className="mb-1.5 block text-xs font-semibold text-muted">Message</label><textarea value={body} onChange={e=>setBody(e.target.value)} rows={4} className="field w-full resize-y" placeholder="Write the announcement…"/></div><div className="grid gap-4 sm:grid-cols-2"><SelectField label="Audience" value={audienceType} onChange={e=>setAudienceType(e.target.value)}><option value="ALL">All employees</option><option value="DEPARTMENT">Department</option></SelectField>{audienceType==="DEPARTMENT"&&<SelectField label="Department" value={audienceId} onChange={e=>setAudienceId(e.target.value)}><option value="">Select department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</SelectField>}</div><button disabled={create.isPending} className="pill-accent flex items-center gap-2 px-4 py-2.5 text-sm"><Plus size={15}/>{create.isPending?"Publishing…":"Publish"}</button></form></div>}
  <div className="space-y-3">{rows.map(a=><article key={a.id} className="card p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-lg font-semibold text-ink">{a.title}</p><p className="mt-1 text-xs text-muted">{new Date(a.publishedAt).toLocaleString()} · {a.createdBy?.name||"Management"}{a.audienceType==="DEPARTMENT"?" · Department audience":" · Everyone"}</p></div>{management&&<button onClick={()=>remove.mutate(a.id)} className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-danger" title="Delete"><Trash2 size={15}/></button>}</div><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-muted">{a.body}</p></article>)}{rows.length===0&&<div className="card p-8 text-center text-sm text-muted">No announcements yet.</div>}</div>
 </div>
}
