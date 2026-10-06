import { useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, Mail, MailPlus, RotateCw, Trash2, UserRound, X } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { ROLE_LABELS } from "../utils/roles"
import SectionHeader from "./ui/SectionHeader"
import { TextField, SelectField, TextAreaField } from "./ui/Field"

const OWNER_ROLES = ["ADMIN", "CEO"]
const emptyForm = {
  name: "",
  email: "",
  role: "EMPLOYEE",
  designation: "",
  departmentId: "",
  managerId: "",
  joiningDate: "",
  employmentStatus: "PROBATION",
  message: "",
}
const STATUS = {
  PENDING: { label: "Pending", tone: "bg-chip-yellow-bg text-chip-yellow-fg" },
  ACCEPTED: { label: "Joined", tone: "bg-chip-green-bg text-chip-green-fg" },
  EXPIRED: { label: "Expired", tone: "bg-surface-2 text-muted" },
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"
}

// Employee Forms → "Invite new employee": creates the account with the
// chosen role / department / manager and emails a one-time link
// (/accept-invite) where the person sets their password and lands on their
// profile. ADMIN/CEO/HR only (same as adding an employee).
export default function InviteEmployeeSection() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isOwner = OWNER_ROLES.includes(user?.role)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState("")
  // { name, email, emailSent, link } after a send / resend.
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  const { data: invitations = [], isLoading } = useQuery({
    queryKey: ["invitations"],
    queryFn: () => api.get("/invitations").then((r) => r.data),
  })
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get("/departments").then((r) => r.data),
    enabled: open,
  })
  const { data: managers = [] } = useQuery({
    queryKey: ["employees", "reporting-managers"],
    queryFn: () => api.get("/employees", { params: { managersOnly: 1, page: 1, pageSize: 100 } }).then((r) => r.data?.data || r.data || []),
    enabled: open,
  })

  const roleOptions = Object.entries(ROLE_LABELS).filter(([value]) => isOwner || !OWNER_ROLES.includes(value))
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  function showResult(res) {
    const inv = res.data.invitation
    setResult({ name: inv.employee.name, email: inv.employee.email, emailSent: res.data.emailSent, link: res.data.link })
    setCopied(false)
    queryClient.invalidateQueries({ queryKey: ["invitations"] })
    queryClient.invalidateQueries({ queryKey: ["employees"] })
  }

  const invite = useMutation({
    mutationFn: () => api.post("/invitations", {
      ...form,
      departmentId: form.departmentId || undefined,
      managerId: form.managerId || undefined,
      joiningDate: form.joiningDate || undefined,
    }),
    onSuccess: (res) => {
      showResult(res)
      setForm(emptyForm)
      setOpen(false)
      setError("")
    },
    onError: (err) => setError(err.response?.data?.error || "Could not send the invitation"),
  })

  const resend = useMutation({
    mutationFn: (id) => api.post(`/invitations/${id}/resend`),
    onSuccess: showResult,
    onError: (err) => setError(err.response?.data?.error || "Could not resend the invitation"),
  })

  const cancel = useMutation({
    mutationFn: (id) => api.delete(`/invitations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] })
      queryClient.invalidateQueries({ queryKey: ["employees"] })
      setResult(null)
    },
    onError: (err) => setError(err.response?.data?.error || "Could not cancel the invitation"),
  })

  function copyLink() {
    navigator.clipboard?.writeText(result.link).then(() => setCopied(true)).catch(() => {})
  }

  const pendingCount = invitations.filter((i) => i.status === "PENDING").length

  return (
    <div className="card mb-5 p-5">
      <SectionHeader
        title="Invite new employee"
        action={(
          <button
            type="button"
            onClick={() => { setOpen((v) => !v); setError("") }}
            className="pill-accent flex items-center gap-1.5 px-4 py-2 text-xs"
          >
            {open ? <X size={14} /> : <MailPlus size={14} />}
            {open ? "Cancel" : "Invite by email"}
          </button>
        )}
      />
      <p className="-mt-2 text-xs text-muted">
        Creates their account with the role and details you choose and emails them a secure link. They set their own password and go straight to their profile. The link works once and expires after 7 days.
      </p>

      {result && (
        <div className={`mt-4 rounded-2xl border p-4 ${result.emailSent ? "border-chip-green-fg/40 bg-chip-green-bg" : "border-chip-yellow-fg/40 bg-chip-yellow-bg"}`}>
          <div className="flex items-start justify-between gap-3">
            <p className={`text-sm font-semibold ${result.emailSent ? "text-chip-green-fg" : "text-chip-yellow-fg"}`}>
              {result.emailSent
                ? `Invitation emailed to ${result.name} (${result.email}).`
                : `${result.name}'s account was created, but the email couldn't be sent — email (SMTP) isn't set up on the server yet.`}
            </p>
            <button type="button" onClick={() => setResult(null)} className="shrink-0 text-muted hover:text-ink" aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">
            {result.emailSent ? "You can also share the link yourself:" : "Copy this link and send it to them yourself (WhatsApp, Teams, email…):"}
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input value={result.link} readOnly className="field min-w-0 flex-1 text-xs" onFocus={(e) => e.target.select()} />
            <button type="button" onClick={copyLink} className="pill-secondary flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs">
              <Copy size={13} /> {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      )}

      {error && !open && <p className="mt-3 text-sm text-danger">{error}</p>}

      {open && (
        <form onSubmit={(e) => { e.preventDefault(); invite.mutate() }} className="mt-4 space-y-4 rounded-2xl border border-border p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextField label="Full name" value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} />
            <TextField label="Email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required hint="The invitation is sent here; it's also their sign-in email" />
            <SelectField label="Role" value={form.role} onChange={(e) => set("role", e.target.value)}>
              {roleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </SelectField>
            <TextField label="Designation" value={form.designation} onChange={(e) => set("designation", e.target.value)} placeholder="e.g. Accountant" maxLength={120} />
            <SelectField label="Department" value={form.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
              <option value="">None</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectField>
            <SelectField label="Reporting manager" value={form.managerId} onChange={(e) => set("managerId", e.target.value)}>
              <option value="">None</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}{m.role ? ` — ${ROLE_LABELS[m.role] || m.role}` : ""}</option>
              ))}
            </SelectField>
            <TextField label="Joining date" type="date" value={form.joiningDate} onChange={(e) => set("joiningDate", e.target.value)} hint="Attendance counts from this date" />
            <SelectField label="Employment status" value={form.employmentStatus} onChange={(e) => set("employmentStatus", e.target.value)}>
              <option value="PROBATION">Probation</option>
              <option value="PERMANENT">Permanent</option>
            </SelectField>
          </div>
          <TextAreaField label="Personal message (optional)" value={form.message} onChange={(e) => set("message", e.target.value)} rows={2} maxLength={1000} placeholder="Welcome to the team! Your first day is Monday at 9 AM." />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" disabled={invite.isPending} className="pill-accent flex items-center gap-1.5 px-5 py-2.5 text-sm disabled:opacity-60">
            <Mail size={14} /> {invite.isPending ? "Sending invitation…" : "Send invitation"}
          </button>
        </form>
      )}

      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold text-ink">
          Invitations{pendingCount > 0 && <span className="ml-1.5 font-normal text-muted">· {pendingCount} waiting to join</span>}
        </p>
        {isLoading ? (
          <p className="text-sm text-muted">Loading invitations…</p>
        ) : invitations.length === 0 ? (
          <p className="text-sm text-muted">No one has been invited yet.</p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {invitations.map((inv) => {
              const status = STATUS[inv.status] || STATUS.PENDING
              const canManage = inv.status !== "ACCEPTED" && (isOwner || !OWNER_ROLES.includes(inv.employee.role))
              return (
                <div key={inv.id} className="flex flex-col gap-3 rounded-2xl border border-border p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-ink">{inv.employee.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.tone}`}>{status.label}</span>
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted">{ROLE_LABELS[inv.employee.role] || inv.employee.role}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {inv.employee.email}
                      {inv.employee.designation ? ` · ${inv.employee.designation}` : ""}
                      {inv.employee.department ? ` · ${inv.employee.department}` : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-2">
                      {inv.status === "ACCEPTED"
                        ? `Joined ${formatDate(inv.acceptedAt)}`
                        : `Sent ${formatDate(inv.lastSentAt)}${inv.sendCount > 1 ? ` (${inv.sendCount}×)` : ""} · ${inv.status === "EXPIRED" ? "expired" : "expires"} ${formatDate(inv.expiresAt)}`}
                      {inv.invitedBy ? ` · by ${inv.invitedBy.name}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Link to={`/employees/${inv.employee.id}`} className="pill-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                      <UserRound size={12} /> Profile
                    </Link>
                    {canManage && (
                      <>
                        <button
                          type="button"
                          onClick={() => { setError(""); resend.mutate(inv.id) }}
                          disabled={resend.isPending}
                          className="pill-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-60"
                          title="Send a new link (the previous one stops working)"
                        >
                          <RotateCw size={12} /> Resend
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Cancel ${inv.employee.name}'s invitation? Their unused account is removed and the link stops working.`)) {
                              setError("")
                              cancel.mutate(inv.id)
                            }
                          }}
                          disabled={cancel.isPending}
                          className="pill-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs text-danger disabled:opacity-60"
                        >
                          <Trash2 size={12} /> Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
