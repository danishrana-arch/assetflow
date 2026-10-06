import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Megaphone, Trash2, Plus, CalendarDays } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { isManagement, hasModuleAccess } from "../utils/roles"
import { formatDateTime } from "../utils/time"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import { TextField, SelectField } from "../components/ui/Field"
import HolidaysPanel from "../components/HolidaysPanel"
import useMarkNotificationsRead from "../hooks/useMarkNotificationsRead"

const TABS = [
  ["announcements", "Announcements", Megaphone],
  ["holidays", "Holidays", CalendarDays],
]

// Announcements + public holidays in one place (the separate Holidays page
// was folded in here; /holidays redirects to ?tab=holidays).
export default function Announcements() {
  useMarkNotificationsRead("ANNOUNCEMENT")
  const { user } = useAuth()
  const qc = useQueryClient()
  const management = isManagement(user?.role)
  // Same gate as POST/DELETE /holidays.
  const canManageHolidays = hasModuleAccess(user?.role, "leave")
  const [params, setParams] = useSearchParams()
  const tab = params.get("tab") === "holidays" ? "holidays" : "announcements"
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [audienceType, setAudienceType] = useState("ALL")
  const [audienceId, setAudienceId] = useState("")

  const { data: rows = [] } = useQuery({ queryKey: ["announcements"], queryFn: () => api.get("/dashboard/announcements").then((r) => r.data) })
  const { data: departments = [] } = useQuery({ queryKey: ["departments"], queryFn: () => api.get("/departments").then((r) => r.data), enabled: management })
  const create = useMutation({
    mutationFn: () => api.post("/dashboard/announcements", { title, body, audienceType, audienceId: audienceType === "DEPARTMENT" ? audienceId : null }),
    onSuccess: () => { setTitle(""); setBody(""); setAudienceId(""); qc.invalidateQueries({ queryKey: ["announcements"] }) },
  })
  const remove = useMutation({ mutationFn: (id) => api.delete(`/dashboard/announcements/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["announcements"] }) })

  function selectTab(key) {
    const next = new URLSearchParams(params)
    if (key === "announcements") next.delete("tab")
    else next.set("tab", key)
    setParams(next, { replace: true })
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Announcements & Holidays"
        subtitle="Company-wide and department updates, and the public holiday calendar."
        actions={management && <span className="pill-accent flex items-center gap-1.5 px-3 py-2 text-xs"><Megaphone size={14} /> Management publishing</span>}
      />

      <div className="flex rounded-2xl border border-border bg-surface p-1 sm:max-w-md" role="tablist">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => selectTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${tab === key ? "bg-accent text-on-accent shadow-sm" : "text-muted hover:text-ink"}`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === "holidays" ? (
        <HolidaysPanel canManage={canManageHolidays} canAnnounce={management} />
      ) : (
        <>
          {management && (
            <div className="card p-5">
              <SectionHeader title="Publish announcement" />
              <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); if (title.trim() && body.trim() && (audienceType !== "DEPARTMENT" || audienceId)) create.mutate() }}>
                <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Office closed Friday" />
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted">Message</label>
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="field w-full resize-y" placeholder="Write the announcement…" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField label="Audience" value={audienceType} onChange={(e) => setAudienceType(e.target.value)}>
                    <option value="ALL">All employees</option>
                    <option value="DEPARTMENT">Department</option>
                  </SelectField>
                  {audienceType === "DEPARTMENT" && (
                    <SelectField label="Department" value={audienceId} onChange={(e) => setAudienceId(e.target.value)}>
                      <option value="">Select department</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </SelectField>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button disabled={create.isPending} className="pill-accent flex items-center gap-2 px-4 py-2.5 text-sm"><Plus size={15} />{create.isPending ? "Publishing…" : "Publish"}</button>
                  {canManageHolidays && (
                    <button type="button" onClick={() => selectTab("holidays")} className="pill-secondary flex items-center gap-2 px-4 py-2.5 text-sm">
                      <CalendarDays size={15} /> Add a holiday
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}
          <div className="space-y-3">
            {rows.map((a) => (
              <article key={a.id} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-ink">{a.title}</p>
                    <p className="mt-1 text-xs text-muted">{formatDateTime(a.publishedAt)} · {a.createdBy?.name || "Management"}{a.audienceType === "DEPARTMENT" ? " · Department audience" : " · Everyone"}</p>
                  </div>
                  {management && <button onClick={() => remove.mutate(a.id)} className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-danger" title="Delete"><Trash2 size={15} /></button>}
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-muted">{a.body}</p>
              </article>
            ))}
            {rows.length === 0 && <div className="card p-8 text-center text-sm text-muted">No announcements yet.</div>}
          </div>
        </>
      )}
    </div>
  )
}
