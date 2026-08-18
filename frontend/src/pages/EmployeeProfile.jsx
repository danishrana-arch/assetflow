import { useEffect, useState } from "react"
import { useParams, Link, useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BadgeCheck, Plus, X, Boxes, Ticket as TicketIcon, Activity, UserX, Pencil, Check, Mail, Phone, KeyRound } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { isManagement } from "../utils/roles"
import StatusBadge from "../components/StatusBadge"
import StatusPill from "../components/ui/StatusPill"
import PageHeader from "../components/ui/PageHeader"
import Avatar from "../components/ui/Avatar"
import IconChip from "../components/ui/IconChip"
import SectionHeader from "../components/ui/SectionHeader"
import { FieldValue, TextField, SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

const LEVEL_LABEL = { INTERN: "Intern", JUNIOR: "Junior", SENIOR: "Senior", LEAD: "Lead" }
const REQUEST_TONE = { PENDING: "yellow", APPROVED: "blue", REJECTED: "pink", FULFILLED: "green" }
const LEVEL_TONE = { INTERN: "slate", JUNIOR: "blue", SENIOR: "green", LEAD: "yellow" }

export default function EmployeeProfile() {
  const { id } = useParams()
  const { organization, user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const canManageInventory = isManagement(user?.role)
  const isSelf = user?.id === id
  // Management can edit every field on anyone (including themselves); a
  // non-management viewer can only edit their own phone/email.
  const canEditFully = canManageInventory
  const canEditContactOnly = !canManageInventory && isSelf
  // Only the Owner (ADMIN) can remove an employee outright.
  const canRemoveEmployee = user?.role === "ADMIN" && user?.id !== id
  // Any management user can reset a forgotten password to the temp value.
  const canResetPassword = canManageInventory && !isSelf
  const [showAssignForm, setShowAssignForm] = useState(false)
  const [selectedAssetId, setSelectedAssetId] = useState("")
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [editError, setEditError] = useState("")
  const [resetResult, setResetResult] = useState(null)
  const [showRequestForm, setShowRequestForm] = useState(false)
  const [requestCategory, setRequestCategory] = useState("")
  const [requestReason, setRequestReason] = useState("")

  const { data: employee, isLoading } = useQuery({
    queryKey: ["employee", id],
    queryFn: () => api.get(`/employees/${id}`).then((r) => r.data),
  })

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get("/departments").then((r) => r.data),
    enabled: canEditFully,
  })

  const { data: availableAssets } = useQuery({
    queryKey: ["assets", "AVAILABLE"],
    queryFn: () => api.get("/assets", { params: { status: "AVAILABLE" } }).then((r) => r.data),
    enabled: canManageInventory && showAssignForm,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["employee", id] })
    queryClient.invalidateQueries({ queryKey: ["assets"] })
  }

  const assignAsset = useMutation({
    mutationFn: () => api.post(`/assets/${selectedAssetId}/assign`, { employeeId: id }),
    onSuccess: () => { invalidate(); setShowAssignForm(false); setSelectedAssetId("") },
  })

  const removeAsset = useMutation({
    mutationFn: (assetId) =>
      api.post(`/assets/${assetId}/status`, {
        status: "AVAILABLE",
        eventType: "UNASSIGNED",
        note: `Unassigned from ${employee?.name || "employee"}`,
      }),
    onSuccess: invalidate,
  })

  const removeEmployee = useMutation({
    mutationFn: () => api.delete(`/employees/${id}`),
    onSuccess: () => navigate("/employees"),
  })

  const resetPassword = useMutation({
    mutationFn: () => api.post(`/employees/${id}/reset-password`),
    onSuccess: (res) => setResetResult(res.data.tempPassword),
  })

  const { data: myRequests } = useQuery({
    queryKey: ["asset-requests", "mine", id],
    queryFn: () => api.get("/asset-requests").then((r) => r.data),
    enabled: isSelf,
  })

  const createRequest = useMutation({
    mutationFn: () => api.post("/asset-requests", { category: requestCategory.trim(), reason: requestReason.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asset-requests", "mine", id] })
      setShowRequestForm(false)
      setRequestCategory("")
      setRequestReason("")
    },
  })

  const cancelRequest = useMutation({
    mutationFn: (requestId) => api.delete(`/asset-requests/${requestId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["asset-requests", "mine", id] }),
  })

  function handleResetPassword() {
    if (!employee) return
    if (window.confirm(`Reset ${employee.name}'s password to the temporary password? They'll need to change it after logging in.`)) {
      resetPassword.mutate()
    }
  }

  const saveEdit = useMutation({
    mutationFn: (data) => api.patch(`/employees/${id}`, data),
    onSuccess: () => {
      invalidate()
      if (isSelf) refreshUser()
      setEditing(false)
      setEditError("")
    },
    onError: (err) => setEditError(err.response?.data?.error || "Could not save changes"),
  })

  function handleRemoveEmployee() {
    if (!employee) return
    if (window.confirm(`Remove ${employee.name}? This can't be undone.`)) removeEmployee.mutate()
  }

  function startEditing() {
    if (!employee) return
    setEditForm({
      name: employee.name || "",
      email: employee.email || "",
      phone: employee.phone || "",
      departmentId: employee.department?.id || "",
      status: employee.status || "ACTIVE",
      cnic: employee.cnic || "",
      dob: employee.dob ? employee.dob.slice(0, 10) : "",
      address: employee.address || "",
      skill: employee.skill || "",
      seniorityLevel: employee.seniorityLevel || "",
      baseSalary: employee.baseSalary ?? "",
      bankName: employee.bankName || "",
      bankAccountNumber: employee.bankAccountNumber || "",
    })
    setEditError("")
    setEditing(true)
  }

  function handleSaveEdit(e) {
    e.preventDefault()
    if (canEditFully) {
      saveEdit.mutate(editForm)
    } else if (canEditContactOnly) {
      saveEdit.mutate({ phone: editForm.phone, email: editForm.email })
    }
  }

  if (isLoading) return <p className="text-sm text-muted">Loading...</p>
  if (!employee) return <p className="text-sm text-muted">Employee not found.</p>

  const level = employee.seniorityLevel
  const levelTone = LEVEL_TONE[level] || "slate"
  const canEdit = canEditFully || canEditContactOnly

  return (
    <div>
      <PageHeader
        title="Employee Profile"
        subtitle="Personal information, assigned assets and activity."
        backTo={canManageInventory ? "/employees" : "/"}
        actions={
          canRemoveEmployee && (
            <button
              onClick={handleRemoveEmployee}
              disabled={removeEmployee.isPending}
              className="pill-secondary flex items-center gap-1.5 px-4 py-2.5 text-sm text-danger disabled:opacity-60"
            >
              <UserX size={15} />
              {removeEmployee.isPending ? "Removing…" : "Remove Employee"}
            </button>
          )
        }
      />
      {removeEmployee.isError && (
        <div className="mb-4 rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">
          {removeEmployee.error?.response?.data?.error || "Could not remove employee"}
        </div>
      )}
      {resetResult && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-chip-blue-bg px-3.5 py-2.5 text-sm text-chip-blue-fg">
          <span>
            Password reset temporary password: <span className="font-mono font-semibold">{resetResult}</span>. Share it with {employee.name} so they can log in and change it.
          </span>
          <button
            onClick={() => navigator.clipboard.writeText(resetResult)}
            className="shrink-0 rounded-full bg-white/60 px-3 py-1 text-xs font-semibold hover:bg-white"
          >
            Copy
          </button>
        </div>
      )}

      {/* Contact panel + content, matching the AssetFlow contact-detail layout */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* LEFT — wider column: assets, tickets, activity */}
        <div className="space-y-5 lg:order-1 lg:col-span-2">
          {/* Assigned Assets */}
          <div className="card p-5">
            <SectionHeader
              title="Assigned Assets"
              action={
                canManageInventory && (
                  <button
                    onClick={() => setShowAssignForm((v) => !v)}
                    className="pill-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs"
                  >
                    {showAssignForm ? <X size={12} /> : <Plus size={12} />}
                    {showAssignForm ? "Cancel" : "Assign"}
                  </button>
                )
              }
            />

            {showAssignForm && (
              <form
                onSubmit={(e) => { e.preventDefault(); if (selectedAssetId) assignAsset.mutate() }}
                className="mb-4 flex gap-2"
              >
                <select
                  value={selectedAssetId}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
                  required
                  className="field flex-1"
                >
                  <option value="">Select an available asset…</option>
                  {(availableAssets || []).map((a) => (
                    <option key={a.id} value={a.id}>{a.name} — {a.serialNumber}</option>
                  ))}
                </select>
                <button type="submit" disabled={assignAsset.isPending} className="pill-accent px-4 text-xs">
                  Assign
                </button>
              </form>
            )}

            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {(employee.assignedAssets || []).map((asset) => (
                <li key={asset.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface-2">
                  <IconChip icon={Boxes} tone="blue" size="sm" />
                  <div className="min-w-0 flex-1">
                    <Link to={`/inventory/${asset.id}`} className="block truncate text-sm font-semibold text-ink hover:text-accent">
                      {asset.name}
                    </Link>
                    <p className="truncate font-mono text-[11px] text-muted">{asset.serialNumber}</p>
                  </div>
                  {canManageInventory && (
                    <button
                      onClick={() => removeAsset.mutate(asset.id)}
                      disabled={removeAsset.isPending}
                      className="shrink-0 text-xs font-semibold text-danger hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
              {employee.assignedAssets?.length === 0 && (
                <EmptyState icon={Boxes} title="No assets assigned" description="Assign an available asset to this employee." />
              )}
            </ul>
          </div>

          {isSelf && (
            <div className="card p-5">
              <SectionHeader
                title="My Asset Requests"
                action={
                  <button
                    onClick={() => setShowRequestForm((v) => !v)}
                    className="pill-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs"
                  >
                    {showRequestForm ? <X size={12} /> : <Plus size={12} />}
                    {showRequestForm ? "Cancel" : "Request"}
                  </button>
                }
              />

              {showRequestForm && (
                <form
                  onSubmit={(e) => { e.preventDefault(); if (requestCategory && requestReason.trim()) createRequest.mutate() }}
                  className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2"
                >
                  <TextField label="What do you need?" value={requestCategory} onChange={(e) => setRequestCategory(e.target.value)} placeholder="e.g. Monitor" required />
                  <TextField label="Reason" value={requestReason} onChange={(e) => setRequestReason(e.target.value)} placeholder="Why you need it" required />
                  <button type="submit" disabled={createRequest.isPending} className="pill-accent px-4 py-2.5 text-xs sm:col-span-2">
                    {createRequest.isPending ? "Submitting…" : "Submit request"}
                  </button>
                </form>
              )}

              <ul className="space-y-2">
                {(myRequests || []).map((r) => (
                  <li key={r.id} className="rounded-2xl bg-surface-2 px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">{r.category}</p>
                      <StatusPill tone={REQUEST_TONE[r.status]}>{r.status}</StatusPill>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{r.reason}</p>
                    {r.fulfilledAsset && (
                      <p className="mt-1 text-xs font-medium text-chip-green-fg">
                        Fulfilled: {r.fulfilledAsset.name} ({r.fulfilledAsset.serialNumber})
                      </p>
                    )}
                    {r.status === "PENDING" && (
                      <button
                        onClick={() => cancelRequest.mutate(r.id)}
                        disabled={cancelRequest.isPending}
                        className="mt-1.5 text-xs font-semibold text-danger hover:underline"
                      >
                        Cancel request
                      </button>
                    )}
                  </li>
                ))}
                {(myRequests || []).length === 0 && (
                  <EmptyState title="No requests yet" description="Need something? Submit a request above." />
                )}
              </ul>
            </div>
          )}

          <div className="card p-5">
            <SectionHeader title="Support History" />
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {(employee.tickets || []).map((ticket) => (
                <li key={ticket.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface-2">
                  <IconChip icon={TicketIcon} tone="orange" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{ticket.subject}</p>
                    <p className="text-xs text-muted">
                      {(ticket.status || "").replaceAll("_", " ").toLowerCase()} · {(ticket.priority || "").toLowerCase()} priority
                    </p>
                  </div>
                </li>
              ))}
              {employee.tickets?.length === 0 && (
                <EmptyState icon={TicketIcon} title="No tickets" description="This employee hasn't raised any support requests." />
              )}
            </ul>
          </div>

          <div className="card p-5">
            <SectionHeader title="Activity" />
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {(employee.lifecycleEvents || []).map((event) => (
                <li key={event.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface-2">
                  <IconChip icon={Activity} tone="purple" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {event.asset?.name || "—"}
                    </p>
                    <p className="text-xs text-muted">
                      {(event.type || "").replaceAll("_", " ").toLowerCase()}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted">
                    {new Date(event.occurredAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
              {employee.lifecycleEvents?.length === 0 && (
                <EmptyState icon={Activity} title="No recent activity" />
              )}
            </ul>
          </div>
        </div>

        <div className="card p-6 lg:order-2">
          <div className="flex flex-col items-center text-center">
            <Avatar name={employee.name} size="2xl" />
            <h2 className="mt-4 text-xl font-bold text-ink" style={{ letterSpacing: "-0.02em" }}>
              {employee.name}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {employee.department?.name || "No department"}
              {organization?.name ? ` · ${organization.name}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              <StatusBadge type="employee" status={employee.status} />
              {level && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide bg-chip-${levelTone}-bg text-chip-${levelTone}-fg`}>
                  <BadgeCheck size={11} strokeWidth={2.5} />
                  {LEVEL_LABEL[level]}
                </span>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2">
              {canEdit && !editing && (
                <button
                  onClick={startEditing}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-surface text-ink transition-colors hover:bg-surface-2"
                  aria-label="Edit"
                  title="Edit"
                >
                  <Pencil size={15} />
                </button>
              )}
              {employee.email && (
                <a
                  href={`mailto:${employee.email}`}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-surface text-ink transition-colors hover:bg-surface-2"
                  aria-label="Email"
                  title="Email"
                >
                  <Mail size={15} />
                </a>
              )}
              {employee.phone && (
                <a
                  href={`tel:${employee.phone}`}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-surface text-ink transition-colors hover:bg-surface-2"
                  aria-label="Call"
                  title="Call"
                >
                  <Phone size={15} />
                </a>
              )}
              {canResetPassword && (
                <button
                  onClick={handleResetPassword}
                  disabled={resetPassword.isPending}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-surface text-ink transition-colors hover:bg-surface-2 disabled:opacity-60"
                  aria-label="Reset password"
                  title="Reset password"
                >
                  <KeyRound size={15} />
                </button>
              )}
              {canRemoveEmployee && (
                <button
                  onClick={handleRemoveEmployee}
                  disabled={removeEmployee.isPending}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-surface text-danger transition-colors hover:bg-chip-pink-bg disabled:opacity-60"
                  aria-label="Remove employee"
                  title="Remove employee"
                >
                  <UserX size={15} />
                </button>
              )}
            </div>
          </div>

          <div className="my-5 divider" />

          <SectionHeader
            title="Detailed Information"
            action={
              editing ? (
                <button onClick={() => setEditing(false)} className="pill-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                  <X size={12} /> Cancel
                </button>
              ) : null
            }
          />

          {editing ? (
            <form onSubmit={handleSaveEdit} className="grid grid-cols-1 gap-4">
              {canEditFully && (
                <TextField label="Full name" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
              )}
              <TextField label="Email" type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} />
              <TextField label="Phone" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} />
              {canEditFully && (
                <>
                  <SelectField label="Department" value={editForm.departmentId} onChange={(e) => setEditForm((f) => ({ ...f, departmentId: e.target.value }))}>
                    <option value="">None</option>
                    {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </SelectField>
                  <SelectField label="Status" value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}>
                    <option value="ACTIVE">Active</option>
                    <option value="ON_LEAVE">On Leave</option>
                    <option value="LEFT_COMPANY">Left Company</option>
                  </SelectField>
                  <TextField label="CNIC" value={editForm.cnic} onChange={(e) => setEditForm((f) => ({ ...f, cnic: e.target.value }))} placeholder="XXXXX-XXXXXXX-X" hint="Stored encrypted" />
                  <TextField label="Date of birth" type="date" value={editForm.dob} onChange={(e) => setEditForm((f) => ({ ...f, dob: e.target.value }))} />
                  <TextField label="Residence" value={editForm.address} onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))} />
                  <TextField label="Skill" value={editForm.skill} onChange={(e) => setEditForm((f) => ({ ...f, skill: e.target.value }))} />
                  <SelectField label="Level" value={editForm.seniorityLevel} onChange={(e) => setEditForm((f) => ({ ...f, seniorityLevel: e.target.value }))}>
                    <option value="">None</option>
                    <option value="INTERN">Intern</option>
                    <option value="JUNIOR">Junior</option>
                    <option value="SENIOR">Senior</option>
                    <option value="LEAD">Lead</option>
                  </SelectField>
                  <TextField
                    label="Base Salary (PKR / month)"
                    type="number"
                    min="25000"
                    step="5000"
                    value={editForm.baseSalary}
                    onChange={(e) => setEditForm((f) => ({ ...f, baseSalary: e.target.value }))}
                    hint="Minimum PKR 25,000 used to generate this employee's payroll"
                  />
                  <TextField
                    label="Bank Name"
                    value={editForm.bankName}
                    onChange={(e) => setEditForm((f) => ({ ...f, bankName: e.target.value }))}
                    placeholder="e.g. HBL, Meezan Bank"
                  />
                  <TextField
                    label="Bank Account Number"
                    value={editForm.bankAccountNumber}
                    onChange={(e) => setEditForm((f) => ({ ...f, bankAccountNumber: e.target.value }))}
                    hint="Stored encrypted used for payroll disbursement"
                  />
                </>
              )}
              {editError && <p className="text-sm text-danger">{editError}</p>}
              <button type="submit" disabled={saveEdit.isPending} className="pill-accent flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm disabled:opacity-60">
                <Check size={14} /> {saveEdit.isPending ? "Saving…" : "Save changes"}
              </button>
            </form>
          ) : (
            <div className="space-y-3.5">
              <FieldValue label="First Name" value={employee.name?.split(" ")[0]} />
              <FieldValue label="Last Name" value={employee.name?.split(" ").slice(1).join(" ")} />
              <FieldValue label="Email" value={employee.email} />
              <FieldValue label="Phone" value={employee.phone} />
              <FieldValue label="Department" value={employee.department?.name} />
              <FieldValue label="Manager" value={employee.manager?.name} />
              <FieldValue label="CNIC" value={employee.cnic} />
              <FieldValue label="Date of Birth" value={employee.dob && new Date(employee.dob).toLocaleDateString(undefined, { timeZone: "UTC" })} />
              <FieldValue label="Residence" value={employee.address} />
              <FieldValue label="Base Salary" value={employee.baseSalary != null ? `PKR ${Number(employee.baseSalary).toLocaleString(undefined, { minimumFractionDigits: 2 })} / month` : undefined} />
              <FieldValue label="Bank" value={employee.bankName} />
              <FieldValue label="Account Number" value={employee.bankAccountNumber} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
