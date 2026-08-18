import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, X, Ticket as TicketIcon } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { isManagement } from "../utils/roles"
import PageHeader from "../components/ui/PageHeader"
import IconChip from "../components/ui/IconChip"
import StatusPill from "../components/ui/StatusPill"
import { TextField, TextAreaField, SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

const PRIORITY_TONE = { LOW: "slate", MEDIUM: "blue", HIGH: "orange", URGENT: "pink" }
const STATUS_TONE = { OPEN: "blue", IN_PROGRESS: "yellow", RESOLVED: "green", CLOSED: "slate" }
const STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]
const CATEGORY_OPTIONS = ["Hardware", "Software", "Access", "Other"]

function humanize(s) {
  return (s || "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())
}

export default function Tickets() {
  const { user } = useAuth()
  const isAdmin = isManagement(user?.role)
  const [showForm, setShowForm] = useState(false)
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState("MEDIUM")
  const [category, setCategory] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("")
  const queryClient = useQueryClient()

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["tickets", categoryFilter],
    queryFn: () => api.get("/tickets", { params: categoryFilter ? { category: categoryFilter } : {} }).then((r) => r.data),
  })

  const createTicket = useMutation({
    mutationFn: () => api.post("/tickets", { subject, description, priority, category: category || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tickets"] })
      setShowForm(false); setSubject(""); setDescription(""); setPriority("MEDIUM"); setCategory("")
    },
  })

  const updateStatus = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/tickets/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tickets"] }),
  })

  const removeTicket = useMutation({
    mutationFn: (id) => api.delete(`/tickets/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tickets"] }),
  })

  function handleRemove(ticket) {
    if (window.confirm(`Remove ticket "${ticket.subject}"?`)) removeTicket.mutate(ticket.id)
  }

  return (
    <div>
      <PageHeader
        backTo="/"
        title="Requests & Tickets"
        subtitle="Support requests raised by your team."
        actions={
          <button
            onClick={() => setShowForm((v) => !v)}
            className="pill-accent flex items-center gap-1.5 px-4 py-2.5 text-sm"
          >
            {showForm ? <X size={15} /> : <Plus size={15} />}
            {showForm ? "Cancel" : "New Ticket"}
          </button>
        }
      />

      {showForm && (
        <form
          onSubmit={(e) => { e.preventDefault(); createTicket.mutate() }}
          className="card mb-5 space-y-4 p-5"
        >
          <TextField
            label="Subject *"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder='e.g. "My laptop battery lasts only 30 minutes"'
            required
          />
          <TextAreaField
            label="Description *"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the issue…"
            required
          />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SelectField label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="min-w-[180px]">
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </SelectField>
            <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="min-w-[180px]">
              <option value="">None</option>
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </SelectField>
            <button type="submit" disabled={createTicket.isPending} className="pill-accent px-5 py-2.5 text-sm">
              Submit ticket
            </button>
          </div>
        </form>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        <button onClick={() => setCategoryFilter("")} className={categoryFilter === "" ? "folder-tab-active" : "tab-pill"}>
          All
        </button>
        {CATEGORY_OPTIONS.map((c) => (
          <button key={c} onClick={() => setCategoryFilter(c)} className={categoryFilter === c ? "folder-tab-active" : "tab-pill"}>
            {c}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <tr className="border-b border-border">
              <th className="px-5 py-3.5">Subject</th>
              <th className="px-5 py-3.5">Category</th>
              <th className="px-5 py-3.5">Raised By</th>
              <th className="px-5 py-3.5">Priority</th>
              <th className="px-5 py-3.5">Status</th>
              {isAdmin && <th className="px-5 py-3.5" />}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={isAdmin ? 6 : 5} className="px-5 py-10 text-center text-muted">Loading…</td></tr>
            )}
            {(tickets || []).map((t) => (
              <tr key={t.id} className="border-b border-border last:border-0 transition-colors hover:bg-surface-2">
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <IconChip icon={TicketIcon} tone={PRIORITY_TONE[t.priority] || "slate"} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{t.subject}</p>
                      <p className="truncate text-xs text-muted">{t.description}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-muted">{t.category || "—"}</td>
                <td className="px-5 py-3.5 text-muted">{t.raisedBy?.name || "—"}</td>
                <td className="px-5 py-3.5">
                  <StatusPill tone={PRIORITY_TONE[t.priority] || "slate"}>{humanize(t.priority)}</StatusPill>
                </td>
                <td className="px-5 py-3.5">
                  {isAdmin ? (
                    <select
                      value={t.status}
                      onChange={(e) => updateStatus.mutate({ id: t.id, status: e.target.value })}
                      className="field !py-1.5 !px-3 !text-xs"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{humanize(s)}</option>
                      ))}
                    </select>
                  ) : (
                    <StatusPill tone={STATUS_TONE[t.status] || "slate"}>{humanize(t.status)}</StatusPill>
                  )}
                </td>
                {isAdmin && (
                  <td className="px-5 py-3.5 text-right">
                    <button onClick={() => handleRemove(t)} className="text-xs font-semibold text-danger hover:underline">
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {tickets?.length === 0 && !isLoading && (
              <tr>
                <td colSpan={isAdmin ? 6 : 5} className="px-5 py-10">
                  <EmptyState icon={TicketIcon} title="No tickets" description="Raise your first support request above." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
