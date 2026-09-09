import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, Link2, Plus, Power, Users, X, Send } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import { TextField, SelectField } from "../components/ui/Field"

function formatDate(value) {
  if (!value) return "—"
  return new Date(value).toLocaleDateString()
}

export default function EmployeeForms() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState("Employee Information Form")
  const [expiresInDays, setExpiresInDays] = useState("30")
  const [createdLink, setCreatedLink] = useState("")
  const [selectedForm, setSelectedForm] = useState(null)
  const [error, setError] = useState("")
  const [recipientEmployeeIds, setRecipientEmployeeIds] = useState([])
  const [employeeSearch, setEmployeeSearch] = useState("")

  const { data: forms = [], isLoading } = useQuery({
    queryKey: ["employee-forms"],
    queryFn: () => api.get("/employee-forms").then((r) => r.data),
  })

  const { data: submissions = [], isLoading: submissionsLoading } = useQuery({
    queryKey: ["employee-form-submissions", selectedForm],
    queryFn: () => api.get(`/employee-forms/${selectedForm}/submissions`).then((r) => r.data),
    enabled: !!selectedForm,
  })

  const { data: employees = [], isLoading: employeesLoading } = useQuery({
    queryKey: ["employee-form-recipients"],
    queryFn: () => api.get("/employees", { params: { status: "ACTIVE" } }).then((r) => r.data?.data || r.data || []),
    enabled: showCreate,
  })

  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase()
    if (!query) return employees
    return employees.filter((employee) =>
      `${employee.name || ""} ${employee.email || ""}`.toLowerCase().includes(query)
    )
  }, [employees, employeeSearch])

  const selectedRecipients = employees.filter((employee) => recipientEmployeeIds.includes(employee.id))

  const createForm = useMutation({
    mutationFn: () => api.post("/employee-forms", { title, expiresInDays: Number(expiresInDays), employeeIds: recipientEmployeeIds }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["employee-forms"] })
      const link = `${window.location.origin}/employee-form/${res.data.token}`
      setCreatedLink(link)
      setShowCreate(false)
      setError("")
      setEmployeeSearch("")
    },
    onError: (err) => setError(err.response?.data?.error || "Could not create form"),
  })

  const toggleForm = useMutation({
    mutationFn: (id) => api.patch(`/employee-forms/${id}/toggle`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee-forms"] }),
  })

  const toggleRecipient = (employeeId) => {
    setRecipientEmployeeIds((current) =>
      current.includes(employeeId)
        ? current.filter((id) => id !== employeeId)
        : [...current, employeeId]
    )
  }

  const selectAllVisible = () => {
    const visibleIds = filteredEmployees.map((employee) => employee.id)
    setRecipientEmployeeIds((current) => Array.from(new Set([...current, ...visibleIds])))
  }

  const clearRecipients = () => setRecipientEmployeeIds([])

  if (!["ADMIN", "CEO"].includes(user?.role)) return null

  return (
    <div>
      <PageHeader
        backTo="/"
        title="Employee Forms"
        subtitle="Create a secure public form link and collect employee information before adding their account."
        actions={(
          <button
            onClick={() => { setShowCreate((value) => !value); setError("") }}
            className="pill-accent flex items-center gap-1.5 px-4 py-2.5 text-sm"
          >
            {showCreate ? <X size={15} /> : <Plus size={15} />}
            {showCreate ? "Cancel" : "Create Form"}
          </button>
        )}
      />

      {createdLink && (
        <div className="card mb-5 border-l-[5px] border-l-chip-green-fg p-5">
          <p className="text-sm font-semibold text-ink">Form created successfully</p>
          <p className="mt-1 text-xs text-muted">Send this link to the employee. Anyone with the link can submit the form until it expires or you deactivate it.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input value={createdLink} readOnly className="field min-w-0 flex-1 text-xs" />
            <button onClick={() => navigator.clipboard.writeText(createdLink)} className="pill-secondary flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs">
              <Copy size={13} /> Copy link
            </button>
            {selectedRecipients.length > 0 && selectedRecipients.some((employee) => employee.email) && (
              <a
                href={`mailto:${selectedRecipients.filter((employee) => employee.email).map((employee) => employee.email).join(",")}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`Hello,\n\nPlease complete your employee information form using this secure link:\n${createdLink}`)}`}
                className="pill-accent flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs"
              >
                <Send size={13} /> Send to {selectedRecipients.filter((employee) => employee.email).length} selected
              </a>
            )}
          </div>
          {selectedRecipients.length > 0 && (
            <p className="mt-2 text-[11px] text-muted">
              Recipients: <span className="font-semibold text-ink">{selectedRecipients.map((employee) => employee.name).join(", ")}</span>
              {selectedRecipients.some((employee) => !employee.email) ? " · Some selected employees have no email address" : ""}
            </p>
          )}
        </div>
      )}

      {showCreate && (
        <form onSubmit={(e) => { e.preventDefault(); createForm.mutate() }} className="card mb-5 space-y-4 p-5">
          <SectionHeader title="Create employee information form" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Form title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            <div className="sm:col-span-2">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-semibold text-ink">Send to existing employees (optional)</label>
                <span className="text-[11px] text-muted">{recipientEmployeeIds.length} selected</span>
              </div>
              <input
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
                placeholder="Search employees by name or email…"
                className="field mb-2 w-full"
              />
              <div className="mb-2 flex flex-wrap gap-2">
                <button type="button" onClick={selectAllVisible} className="pill-secondary px-3 py-1.5 text-[11px]">Select all visible</button>
                <button type="button" onClick={clearRecipients} className="pill-secondary px-3 py-1.5 text-[11px]" disabled={!recipientEmployeeIds.length}>Clear</button>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-2xl border border-border bg-surface-2 p-2">
                {employeesLoading ? (
                  <p className="p-3 text-sm text-muted">Loading employees…</p>
                ) : filteredEmployees.length === 0 ? (
                  <p className="p-3 text-sm text-muted">No active employees found.</p>
                ) : filteredEmployees.map((employee) => {
                  const checked = recipientEmployeeIds.includes(employee.id)
                  return (
                    <label key={employee.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-1">
                      <input type="checkbox" checked={checked} onChange={() => toggleRecipient(employee.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{employee.name}</span>
                        <span className="block truncate text-[11px] text-muted">{employee.email || "No email address"}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
            <SelectField label="Link expires after" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} className="sm:col-span-2">
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </SelectField>
          </div>
          <div className="rounded-2xl bg-surface-2 p-4 text-xs text-muted">
            The form collects name, father name, personal/company email, phone, address, CNIC, date of birth, education, current university, employee type and LinkedIn ID. Select one or multiple existing employees; after the form is created you can send the same secure link directly to all selected employees with one email action.
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" disabled={createForm.isPending} className="pill-accent px-5 py-2.5 text-sm disabled:opacity-60">
            {createForm.isPending ? "Generating link…" : "Generate secure link"}
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="card p-5">
          <SectionHeader title="Your forms" />
          <div className="mt-4 space-y-3">
            {isLoading && <p className="text-sm text-muted">Loading forms…</p>}
            {!isLoading && forms.length === 0 && <p className="text-sm text-muted">No employee forms created yet.</p>}
            {forms.map((form) => {
              const link = form.publicToken ? `${window.location.origin}/employee-form/${form.publicToken}` : ""
              return (
                <div key={form.id} className={`rounded-2xl border p-4 ${selectedForm === form.id ? "border-accent" : "border-border"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{form.title}</p>
                      <p className="mt-0.5 text-xs text-muted">Created {formatDate(form.createdAt)} · Expires {formatDate(form.expiresAt)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${form.active ? "bg-chip-green-bg text-chip-green-fg" : "bg-surface-2 text-muted"}`}>
                      {form.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button onClick={() => setSelectedForm(form.id)} className="pill-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                      <Users size={12} /> {form.submissionCount} responses
                    </button>
                    <button onClick={() => toggleForm.mutate(form.id)} disabled={toggleForm.isPending} className="pill-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                      <Power size={12} /> {form.active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => navigator.clipboard.writeText(link)}
                      className="pill-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs"
                    >
                      <Link2 size={12} /> Copy link
                    </button>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-2">The form link is generated from a private token. Use the Copy link button rather than editing it.</p>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card p-5">
          <SectionHeader title={selectedForm ? "Form responses" : "Select a form"} />
          {!selectedForm ? (
            <p className="mt-4 text-sm text-muted">Select a form to view submitted employee information.</p>
          ) : submissionsLoading ? (
            <p className="mt-4 text-sm text-muted">Loading responses…</p>
          ) : submissions.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No responses yet.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {submissions.map((submission) => (
                <details key={submission.id} className="rounded-2xl border border-border bg-surface-2">
                  <summary className="cursor-pointer list-none p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{submission.name}</p>
                        <p className="text-xs text-muted">{submission.personalEmail || submission.phone || "No contact provided"} · Submitted {formatDate(submission.submittedAt)}</p>
                      </div>
                      <span className="rounded-full bg-chip-blue-bg px-2.5 py-1 text-[10px] font-semibold text-chip-blue-fg">{submission.status}</span>
                    </div>
                  </summary>
                  <div className="grid grid-cols-1 gap-3 border-t border-border p-4 sm:grid-cols-2">
                    <p className="text-xs text-muted"><strong className="text-ink">Father:</strong> {submission.fatherName || "—"}</p>
                    <p className="text-xs text-muted"><strong className="text-ink">Personal email:</strong> {submission.personalEmail || "—"}</p>
                    <p className="text-xs text-muted"><strong className="text-ink">Company email:</strong> {submission.companyEmail || "—"}</p>
                    <p className="text-xs text-muted"><strong className="text-ink">Phone:</strong> {submission.phone || "—"}</p>
                    <p className="text-xs text-muted"><strong className="text-ink">CNIC:</strong> {submission.cnic || "—"}</p>
                    <p className="text-xs text-muted"><strong className="text-ink">DOB:</strong> {formatDate(submission.dob)}</p>
                    <p className="text-xs text-muted"><strong className="text-ink">Education:</strong> {submission.education || "—"}</p>
                    <p className="text-xs text-muted"><strong className="text-ink">University:</strong> {submission.currentUniversity || "—"}</p>
                    <p className="text-xs text-muted"><strong className="text-ink">Employee type:</strong> {submission.seniorityLevel || "—"}</p>
                    <p className="text-xs text-muted"><strong className="text-ink">LinkedIn:</strong> {submission.linkedinUrl || "—"}</p>
                    <p className="text-xs text-muted sm:col-span-2"><strong className="text-ink">Address:</strong> {submission.address || "—"}</p>
                    <p className="text-xs text-muted sm:col-span-2"><strong className="text-ink">Notes:</strong> {submission.notes || "—"}</p>
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
