import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { Search, Plus, X, Copy, Trash2, Upload, Download } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { ROLE_LABELS } from "../utils/roles"
import StatusBadge from "../components/StatusBadge"
import PageHeader from "../components/ui/PageHeader"
import Avatar from "../components/ui/Avatar"
import Pagination from "../components/ui/Pagination"
import { TextField, SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

const PAGE_SIZE = 25

const emptyForm = {
  name: "",
  email: "",
  password: "",
  role: "EMPLOYEE",
  departmentId: "",
  managerId: "",
  phone: "",
  cnic: "",
  dob: "",
  address: "",
  skill: "",
  seniorityLevel: "",
}

function slugName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join(".")
}

function useDebouncedValue(value, delay = 350) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export default function Employees() {
  const { user } = useAuth()
  const isOwner = user?.role === "ADMIN"
  const canManageEmployees = user?.role === "ADMIN" || user?.role === "CEO"
  const canDeleteEmployee = (emp) => canManageEmployees && emp.id !== user?.id && (user?.role === "CEO" || emp.role !== "CEO")
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search)
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [emailTouched, setEmailTouched] = useState(false)
  const [error, setError] = useState("")
  const [created, setCreated] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [importError, setImportError] = useState("")
  const fileInputRef = useRef(null)
  const queryClient = useQueryClient()

  useEffect(() => { setPage(1) }, [debouncedSearch])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["employees", debouncedSearch, page],
    queryFn: () =>
      api
        .get("/employees", { params: { search: debouncedSearch, page, pageSize: PAGE_SIZE } })
        .then((r) => r.data),
    placeholderData: keepPreviousData,
  })
  const employees = data?.data || []
  const { data: managerCandidates = [] } = useQuery({
    queryKey: ["employees", "manager-candidates"],
    queryFn: () => api.get("/employees").then((r) => r.data),
    enabled: canManageEmployees && showForm,
  })
  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get("/departments").then((r) => r.data),
  })
  const { data: organization } = useQuery({
    queryKey: ["organization"],
    queryFn: () => api.get("/organization").then((r) => r.data),
  })

  function updateField(key, value) {
    setForm((f) => {
      const next = { ...f, [key]: value }
      if (key === "name" && !emailTouched && organization?.slug) {
        const local = slugName(value)
        next.email = local ? `${local}@${organization.slug}.com` : ""
      }
      return next
    })
  }

  const addEmployee = useMutation({
    mutationFn: () =>
      api.post("/auth/invite", {
        ...form,
        password: form.password || undefined,
        role: canManageEmployees ? form.role : undefined,
        departmentId: form.departmentId || undefined,
        managerId: form.managerId || undefined,
        seniorityLevel: form.seniorityLevel || undefined,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] })
      setCreated({ email: res.data.employee.email, tempPassword: res.data.tempPassword })
      setShowForm(false)
      setForm(emptyForm)
      setEmailTouched(false)
      setError("")
    },
    onError: (err) => setError(err.response?.data?.error || "Could not add employee"),
  })

  const removeEmployee = useMutation({
    mutationFn: (id) => api.delete(`/employees/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
    onError: (err) => setError(err.response?.data?.error || "Could not remove employee"),
  })

  const importFile = useMutation({
    mutationFn: (file) => {
      const formData = new FormData()
      formData.append("file", file)
      return api.post("/employees/import", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] })
      setImportResult(res.data)
      setImportError("")
    },
    onError: (err) => setImportError(err.response?.data?.error || "Could not import that file"),
  })

  function handleRemove(emp) {
    if (window.confirm(`Remove ${emp.name}? This can't be undone.`)) removeEmployee.mutate(emp.id)
  }

  function handleFileChosen(e) {
    const file = e.target.files?.[0]
    e.target.value = "" 
    if (!file) return
    setImportResult(null)
    setImportError("")
    importFile.mutate(file)
  }

  async function handleDownloadTemplate() {
    const res = await api.get("/employees/import/template", { responseType: "blob" })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement("a")
    a.href = url
    a.download = "employee-import-template.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader
        backTo="/"
        title="Employees"
        subtitle="Everyone in your workspace and the assets they're using."
        actions={
          <>
            <div className="relative w-64">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employees..."
                className="field pl-9 !rounded-full"
              />
            </div>
            {canManageEmployees && (
              <>
                <button
                  onClick={handleDownloadTemplate}
                  className="pill-secondary flex items-center gap-1.5 px-3.5 py-2.5 text-sm"
                  title="Download the import template"
                >
                  <Download size={14} /> Template
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importFile.isPending}
                  className="pill-secondary flex items-center gap-1.5 px-3.5 py-2.5 text-sm disabled:opacity-60"
                >
                  <Upload size={14} /> {importFile.isPending ? "Importing…" : "Import CSV"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChosen}
                  className="hidden"
                />
              </>
            )}
            <button
              onClick={() => { setShowForm((v) => !v); setCreated(null) }}
              className="pill-accent flex items-center gap-1.5 px-4 py-2.5 text-sm"
            >
              {showForm ? <X size={15} /> : <Plus size={15} />}
              {showForm ? "Cancel" : "Add Employee"}
            </button>
          </>
        }
      />

      {importError && (
        <div className="mb-5 rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">{importError}</div>
      )}

      {importResult && (
        <div className="mb-5 card space-y-2 border-l-[6px] border-l-chip-blue-fg p-5">
          <p className="text-sm font-semibold text-ink">
            Import finished — {importResult.createdCount} added, {importResult.skippedCount} skipped.
          </p>
          {importResult.created?.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-xl bg-surface-2 p-3 text-xs">
              {importResult.created.map((c) => (
                <p key={c.row} className="text-muted">
                  Row {c.row}: <span className="font-medium text-ink">{c.email}</span> — temp password{" "}
                  <span className="font-mono text-ink">{c.tempPassword}</span>
                </p>
              ))}
            </div>
          )}
          {importResult.skipped?.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-xl bg-chip-yellow-bg p-3 text-xs text-chip-yellow-fg">
              {importResult.skipped.map((s, i) => (
                <p key={i}>Row {s.row}: {s.reason}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {created && (
        <div className="mb-5 card flex flex-wrap items-center justify-between gap-3 border-l-[6px] border-l-chip-green-fg p-5">
          <div>
            <p className="text-sm font-semibold text-ink">Employee added — {created.email}</p>
            <p className="mt-0.5 text-sm text-muted">
              Temporary password: <span className="font-mono text-ink">{created.tempPassword}</span> — share it so they can log in.
            </p>
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(created.tempPassword)}
            className="pill-secondary flex items-center gap-1.5 px-3.5 py-1.5 text-xs"
          >
            <Copy size={13} /> Copy
          </button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (form.name.trim() && form.email.trim()) addEmployee.mutate()
          }}
          className="card mb-5 space-y-4 p-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextField label="Full name *" value={form.name} onChange={(e) => updateField("name", e.target.value)} required />
            <TextField
              label="Email *"
              type="email"
              value={form.email}
              onChange={(e) => { setEmailTouched(true); updateField("email", e.target.value) }}
              hint={organization?.slug ? `Suggested from ${organization.name}'s domain — edit freely` : undefined}
              required
            />
            <TextField
              label="Temporary password"
              type="password"
              value={form.password}
              onChange={(e) => updateField("password", e.target.value)}
              hint="Optional: leave blank to auto-generate a temp password"
            />
            {canManageEmployees ? (
              <SelectField label="Role" value={form.role} onChange={(e) => updateField("role", e.target.value)}>
                {Object.entries(ROLE_LABELS)
                  .filter(([value]) => value !== "CEO" || (data?.ceoCount || 0) < 2)
                  .map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
              </SelectField>
            ) : (
              <TextField label="Role" value="Employee" disabled hint="Only an ADMIN or CEO can create management accounts" />
            )}
            <SelectField label="Department" value={form.departmentId} onChange={(e) => updateField("departmentId", e.target.value)}>
              <option value="">None</option>
              {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectField>
            <SelectField label="Reporting Manager" value={form.managerId} onChange={(e) => updateField("managerId", e.target.value)}>
              <option value="">None</option>
              {(managerCandidates || []).map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name}{manager.role ? ` — ${ROLE_LABELS[manager.role] || manager.role}` : ""}
                </option>
              ))}
            </SelectField>
            <TextField label="Phone" value={form.phone} onChange={(e) => updateField("phone", e.target.value)} />
            <TextField label="CNIC" value={form.cnic} onChange={(e) => updateField("cnic", e.target.value)} placeholder="XXXXX-XXXXXXX-X" hint="Stored encrypted" />
            <TextField label="Date of birth" type="date" value={form.dob} onChange={(e) => updateField("dob", e.target.value)} />
            <TextField label="Residence" value={form.address} onChange={(e) => updateField("address", e.target.value)} className="sm:col-span-2 lg:col-span-1" />
            <TextField label="Skill" value={form.skill} onChange={(e) => updateField("skill", e.target.value)} placeholder="e.g. Frontend Development" />
            <SelectField label="Level" value={form.seniorityLevel} onChange={(e) => updateField("seniorityLevel", e.target.value)}>
              <option value="">None</option>
              <option value="INTERN">Intern</option>
              <option value="JUNIOR">Junior</option>
              <option value="SENIOR">Senior</option>
              <option value="LEAD">Lead</option>
            </SelectField>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" disabled={addEmployee.isPending} className="pill-accent px-5 py-2.5 text-sm">
            Add employee
          </button>
        </form>
      )}

      {isLoading && <p className="text-sm text-muted">Loading...</p>}

    
      <div className="space-y-3 md:hidden">
        {employees.map((emp) => (
          <div key={emp.id} className="card flex items-center gap-3 p-4">
            <Avatar name={emp.name} size="md" />
            <Link to={`/employees/${emp.id}`} className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{emp.name}</p>
              <p className="truncate text-xs text-muted">{emp.email}</p>
              <p className="mt-0.5 text-xs text-muted-2">
                {ROLE_LABELS[emp.role] || emp.role} · {emp.department?.name || "No department"}
              </p>
            </Link>
            <div className="flex flex-col items-end gap-2">
              <StatusBadge type="employee" status={emp.status} />
              {canDeleteEmployee(emp) && (
                <button onClick={() => handleRemove(emp)} className="text-muted hover:text-danger" aria-label={`Remove ${emp.name}`}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>
        ))}
        {employees.length === 0 && !isLoading && <EmptyState title="No employees" description="Add your first employee to get started." />}
      </div>

      <div className="hidden card overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              <tr className="border-b border-border">
                <th className="px-5 py-3.5">Employee</th>
                <th className="px-5 py-3.5">Role</th>
                <th className="px-5 py-3.5">Department</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5">Assets</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-b border-border last:border-0 transition-colors hover:bg-surface-2">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={emp.name} size="sm" />
                      <div className="min-w-0">
                        <Link to={`/employees/${emp.id}`} className="block truncate font-semibold text-ink hover:text-accent">
                          {emp.name}
                        </Link>
                        <p className="truncate text-xs text-muted">{emp.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-muted">{ROLE_LABELS[emp.role] || emp.role}</td>
                  <td className="px-5 py-3.5 text-muted">{emp.department?.name || "—"}</td>
                  <td className="px-5 py-3.5"><StatusBadge type="employee" status={emp.status} /></td>
                  <td className="px-5 py-3.5 text-muted">{emp.assignedAssets?.length || 0}</td>
                  <td className="px-5 py-3.5 text-right">
                    {canDeleteEmployee(emp) && (
                      <button onClick={() => handleRemove(emp)} className="text-xs font-semibold text-danger hover:underline">
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {employees.length === 0 && !isLoading && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-muted">No employees found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={data?.page || 1}
        totalPages={data?.totalPages || 1}
        total={data?.total || 0}
        pageSize={data?.pageSize || PAGE_SIZE}
        onPageChange={setPage}
      />
      {isFetching && !isLoading && <p className="mt-1 text-center text-xs text-muted-2">Refreshing…</p>}
    </div>
  )
}
