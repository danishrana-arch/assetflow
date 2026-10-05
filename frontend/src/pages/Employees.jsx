import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"
import {
  Search, Plus, X, Copy, Trash2, Upload, FileOutput, Pencil, Mail, FileDown,
  MoreHorizontal, ArrowUp, ArrowDown, ArrowUpDown, User as UserIcon,
} from "lucide-react"
import api from "../api/client"
import BackButton from "../components/ui/BackButton"
import { useAuth } from "../context/AuthContext"
import { ROLE_LABELS } from "../utils/roles"
import StatusBadge from "../components/StatusBadge"
import Avatar from "../components/ui/Avatar"
import Pagination from "../components/ui/Pagination"
import { TextField, SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

const PAGE_SIZE = 25
// Any spreadsheet the backend can read (utils/sheet.js): Excel, Google Sheets
// downloads, CSV/TSV.
const SHEET_ACCEPT = ".xlsx,.xlsm,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
const SHEET_LABEL = "Excel .xlsx, Google Sheets download, .csv or .tsv"

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
  joiningDate: "",
  startDate: "",
  employmentStatus: "PROBATION",
}

const STATUS_LABELS = { ACTIVE: "Active", ON_LEAVE: "On Leave", LEFT_COMPANY: "Left Company" }
const TYPE_LABELS = { OFFICE: "Office", FIELD: "Field" }

// Same tinted-tile treatment as the dashboard Attendance Snapshot.
const STAT_TILES = [
  { key: "", label: "Total Employees", dot: "bg-ink", tile: "bg-surface-2 border-border" },
  {
    key: "ACTIVE", label: "Active", dot: "bg-success",
    tile: "bg-chip-green-bg/40 border-chip-green-bg dark:bg-chip-green-bg/[0.06] dark:border-chip-green-bg/10",
  },
  {
    key: "ON_LEAVE", label: "On Leave", dot: "bg-chip-blue-fg dark:bg-chip-blue-bg",
    tile: "bg-chip-blue-bg/35 border-chip-blue-bg/80 dark:bg-chip-blue-bg/[0.06] dark:border-chip-blue-bg/10",
  },
  {
    key: "LEFT_COMPANY", label: "Left Company", dot: "bg-danger",
    tile: "bg-chip-pink-bg/35 border-chip-pink-bg/80 dark:bg-chip-pink-bg/[0.06] dark:border-chip-pink-bg/10",
  },
]

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

function formatDay(value) {
  if (!value) return "—"
  return String(value).slice(0, 10)
}

function csvCell(value) {
  const s = value == null ? "" : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(rows) {
  const header = ["Name", "Email", "Designation", "Role", "Status", "Department", "Manager", "Start Day", "Type", "Assets"]
  const lines = rows.map((e) => [
    e.name,
    e.email,
    e.designation || "",
    ROLE_LABELS[e.role] || e.role,
    STATUS_LABELS[e.status] || e.status,
    e.department?.name || "",
    e.manager?.name || "",
    e.joiningDate ? formatDay(e.joiningDate) : "",
    TYPE_LABELS[e.workLocationType] || "",
    e.assignedAssets?.length || 0,
  ].map(csvCell).join(","))
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `employees-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function SortHeader({ label, field, sort, onSort }) {
  const active = sort.field === field
  const Icon = !active ? ArrowUpDown : sort.order === "asc" ? ArrowUp : ArrowDown
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`inline-flex items-center gap-1 hover:text-ink ${active ? "text-ink" : ""}`}
    >
      {label} <Icon size={12} className={active ? "" : "opacity-50"} />
    </button>
  )
}

// "…" menu, rendered in a portal so the table's scroll container can't clip it.
function RowMenu({ emp, canDelete, onRemove }) {
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    const onKey = (e) => e.key === "Escape" && close()
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
      window.removeEventListener("keydown", onKey)
    }
  }, [pos])

  function toggle() {
    if (pos) return setPos(null)
    const r = btnRef.current.getBoundingClientRect()
    const height = canDelete ? 132 : 92
    const top = r.bottom + height + 8 > window.innerHeight ? r.top - height - 4 : r.bottom + 4
    setPos({ top, left: Math.max(8, r.right - 180) })
  }

  const item = "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
        aria-label={`More actions for ${emp.name}`}
        aria-expanded={!!pos}
      >
        <MoreHorizontal size={16} />
      </button>
      {pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
          <div
            role="menu"
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 w-[180px] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-card"
          >
            <button className={`${item} text-ink`} onClick={() => { setPos(null); navigate(`/employees/${emp.id}`) }}>
              <UserIcon size={14} /> View profile
            </button>
            <button className={`${item} text-ink`} onClick={() => { setPos(null); navigator.clipboard?.writeText(emp.email) }}>
              <Copy size={14} /> Copy email
            </button>
            {canDelete && (
              <button className={`${item} text-danger`} onClick={() => { setPos(null); onRemove(emp) }}>
                <Trash2 size={14} /> Remove
              </button>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  )
}

export default function Employees() {
  const { user } = useAuth()
  const canManageEmployees = user?.role === "ADMIN" || user?.role === "CEO"
  const canDeleteEmployee = (emp) => canManageEmployees && emp.id !== user?.id && (user?.role === "CEO" || emp.role !== "CEO")
  // HR can create employees with any non-owner role (backend: inviteEmployee).
  const isHR = user?.role === "HR"
  const canPickRole = canManageEmployees || isHR
  // Adding (single or by sheet import) is ADMIN/CEO/HR only — matches the API.
  const canAddEmployees = canPickRole
  // DEPARTMENT_HEAD is always scoped to their own department by the API.
  const showDepartmentFilter = user?.role !== "DEPARTMENT_HEAD"

  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search)
  // ?status= preselects a status tile (e.g. the CEO dashboard Company overview).
  const [filters, setFilters] = useState(() => {
    const status = new URLSearchParams(window.location.search).get("status")
    return { status: STAT_TILES.some((t) => t.key && t.key === status) ? status : "", department: "", role: "" }
  })
  const [sort, setSort] = useState({ field: "name", order: "asc" })
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(() => new Set())
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [emailTouched, setEmailTouched] = useState(false)
  const [error, setError] = useState("")
  const [created, setCreated] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [importError, setImportError] = useState("")
  const [exporting, setExporting] = useState(false)
  const fileInputRef = useRef(null)
  const queryClient = useQueryClient()

  const listParams = {
    search: debouncedSearch || undefined,
    status: filters.status || undefined,
    department: filters.department || undefined,
    role: filters.role || undefined,
    sort: sort.field,
    order: sort.order,
  }

  useEffect(() => { setPage(1); setSelected(new Set()) }, [debouncedSearch, filters, sort])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["employees", listParams, page],
    queryFn: () =>
      api.get("/employees", { params: { ...listParams, page, pageSize: PAGE_SIZE } }).then((r) => r.data),
    placeholderData: keepPreviousData,
  })
  const employees = data?.data || []
  const counts = data?.statusCounts || {}
  const totalCount = (counts.ACTIVE || 0) + (counts.ON_LEAVE || 0) + (counts.LEFT_COMPANY || 0)

  const { data: managerCandidates = [] } = useQuery({
    queryKey: ["employees", "manager-candidates"],
    queryFn: () => api.get("/employees", { params: { includeCompanyManagers: true, page: 1, pageSize: 100 } }).then((r) => r.data?.data || r.data || []),
    enabled: canPickRole && showForm,
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

  function setFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  function toggleSort(field) {
    setSort((s) => (s.field === field ? { field, order: s.order === "asc" ? "desc" : "asc" } : { field, order: "asc" }))
  }

  const addEmployee = useMutation({
    mutationFn: () =>
      api.post("/auth/invite", {
        ...form,
        password: form.password || undefined,
        role: canPickRole ? form.role : undefined,
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
    onSuccess: (_res, id) => {
      setSelected((s) => { const n = new Set(s); n.delete(id); return n })
      queryClient.invalidateQueries({ queryKey: ["employees"] })
    },
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
    setError("")
    if (window.confirm(`Remove ${emp.name}? This can't be undone.`)) removeEmployee.mutate(emp.id)
  }

  async function handleRemoveSelected() {
    const targets = employees.filter((e) => selected.has(e.id) && canDeleteEmployee(e))
    if (targets.length === 0) return
    if (!window.confirm(`Remove ${targets.length} employee${targets.length > 1 ? "s" : ""}? This can't be undone.`)) return
    setError("")
    const failed = []
    for (const emp of targets) {
      try {
        await api.delete(`/employees/${emp.id}`)
      } catch (err) {
        failed.push(`${emp.name}: ${err.response?.data?.error || "could not remove"}`)
      }
    }
    setSelected(new Set())
    queryClient.invalidateQueries({ queryKey: ["employees"] })
    if (failed.length) setError(failed.join(" · "))
  }

  async function handleTemplate() {
    try {
      const res = await api.get("/employees/import/template", { responseType: "blob" })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement("a")
      a.href = url
      a.download = "employee-import-template.csv"
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setImportError("Could not download the template")
    }
  }

  function handleFileChosen(e) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setImportResult(null)
    setImportError("")
    importFile.mutate(file)
  }

  // Exports the selected rows, or else every employee matching the current filters.
  async function handleExport() {
    setError("")
    if (selected.size > 0) return downloadCsv(employees.filter((e) => selected.has(e.id)))
    setExporting(true)
    try {
      const res = await api.get("/employees", { params: listParams })
      downloadCsv(Array.isArray(res.data) ? res.data : res.data?.data || [])
    } catch (err) {
      setError(err.response?.data?.error || "Could not export the employee list")
    } finally {
      setExporting(false)
    }
  }

  const allOnPageSelected = employees.length > 0 && employees.every((e) => selected.has(e.id))
  function toggleAll() {
    setSelected(allOnPageSelected ? new Set() : new Set(employees.map((e) => e.id)))
  }
  function toggleOne(id) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const deletableSelected = employees.filter((e) => selected.has(e.id) && canDeleteEmployee(e)).length
  const hasFilters = !!(filters.status || filters.department || filters.role || search)

  const actionBtn = "rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink"

  return (
    <div className="space-y-5">
      {/* Header + stat tiles */}
      <div className="card p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BackButton />
            <h1 className="text-2xl font-bold text-ink">Employees</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canAddEmployees && (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importFile.isPending}
                  className="pill-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:opacity-60"
                  title={`Import from a spreadsheet (${SHEET_LABEL})`}
                >
                  <Upload size={14} /> {importFile.isPending ? "Importing…" : "Import Sheet"}
                </button>
                <input ref={fileInputRef} type="file" accept={SHEET_ACCEPT} onChange={handleFileChosen} className="hidden" />
                <button
                  onClick={handleTemplate}
                  className="pill-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm"
                  title="Download a CSV with every column the import understands"
                >
                  <FileDown size={14} /> Import Template
                </button>
              </>
            )}
            <button
              onClick={handleExport}
              disabled={exporting}
              className="pill-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:opacity-60"
            >
              <FileOutput size={14} /> {exporting ? "Exporting…" : selected.size > 0 ? `Export ${selected.size} selected` : "Export List"}
            </button>
            {canAddEmployees && (
              <button
                onClick={() => { setShowForm((v) => !v); setCreated(null) }}
                className="pill-accent flex items-center gap-1.5 px-4 py-2 text-sm"
              >
                {showForm ? <X size={15} /> : <Plus size={15} />}
                {showForm ? "Cancel" : "Add Employees"}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {STAT_TILES.map((t) => {
            const value = t.key ? counts[t.key] || 0 : totalCount
            const active = filters.status === t.key
            return (
              <button
                key={t.label}
                type="button"
                onClick={() => setFilter("status", t.key)}
                aria-pressed={active}
                className={`rounded-2xl border p-4 text-left transition-all hover:-translate-y-px hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${t.tile} ${
                  active ? "ring-2 ring-accent" : ""
                }`}
              >
                <p className="flex items-center gap-2 text-xs font-medium text-muted">
                  <span className={`h-2 w-2 rounded-full ${t.dot}`} /> {t.label}
                </p>
                <p className="mt-2 text-2xl font-bold text-ink">{data ? value.toLocaleString() : "—"}</p>
              </button>
            )
          })}
        </div>
      </div>

      {importError && (
        <div className="rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">{importError}</div>
      )}

      {importResult && (
        <div className="card space-y-2 border-l-[6px] border-l-chip-blue-fg p-5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-ink">
              Import finished — {importResult.createdCount} added, {importResult.skippedCount} skipped.
            </p>
            <button onClick={() => setImportResult(null)} className="text-muted hover:text-ink" aria-label="Dismiss"><X size={15} /></button>
          </div>
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
          {importResult.warnings?.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-xl bg-surface-2 p-3 text-xs text-muted">
              <p className="mb-1 font-semibold text-ink">Imported, but some values were left blank:</p>
              {importResult.warnings.map((w, i) => (
                <p key={i}>Row {w.row}: {w.reason}</p>
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
        <div className="card flex flex-wrap items-center justify-between gap-3 border-l-[6px] border-l-chip-green-fg p-5">
          <div>
            <p className="text-sm font-semibold text-ink">Employee added : {created.email}</p>
            <p className="mt-0.5 text-sm text-muted">
              Temporary password: <span className="font-mono text-ink">{created.tempPassword}</span> , share it so they can log in.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(created.tempPassword)}
              className="pill-secondary flex items-center gap-1.5 px-3.5 py-1.5 text-xs"
            >
              <Copy size={13} /> Copy
            </button>
            <button onClick={() => setCreated(null)} className="text-muted hover:text-ink" aria-label="Dismiss"><X size={15} /></button>
          </div>
        </div>
      )}

      {showForm && canAddEmployees && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (form.name.trim() && form.email.trim()) addEmployee.mutate()
          }}
          className="card space-y-4 p-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextField label="Full name *" value={form.name} onChange={(e) => updateField("name", e.target.value)} required />
            <TextField
              label="Email *"
              type="email"
              value={form.email}
              onChange={(e) => { setEmailTouched(true); updateField("email", e.target.value) }}
              hint={organization?.slug ? `Suggested from ${organization.name}'s domain edit freely` : undefined}
              required
            />
            <TextField
              label="Temporary password"
              type="password"
              value={form.password}
              onChange={(e) => updateField("password", e.target.value)}
              hint="Optional: leave blank to auto-generate a temp password"
            />
            {canPickRole ? (
              <SelectField label="Role" value={form.role} onChange={(e) => updateField("role", e.target.value)}>
                {Object.entries(ROLE_LABELS)
                  .filter(([value]) => value !== "CEO" || (data?.ceoCount || 0) < 3)
                  .filter(([value]) => !isHR || !["ADMIN", "CEO"].includes(value))
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
            <TextField label="Joining date" type="date" value={form.joiningDate} onChange={(e) => updateField("joiningDate", e.target.value)} hint="Joined the company" />
            <TextField label="Start date" type="date" value={form.startDate} onChange={(e) => updateField("startDate", e.target.value)} hint="Started the assigned operation / campaign" />
            <SelectField label="Employment status" value={form.employmentStatus} onChange={(e) => updateField("employmentStatus", e.target.value)}>
              <option value="PROBATION">Probation</option>
              <option value="PERMANENT">Permanent (from today)</option>
            </SelectField>
          </div>
          <p className="text-xs text-muted-2">Passport, civil number, emergency contact and documents can be added from the employee's profile after saving.</p>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            Adding many people at once?
            <button type="button" onClick={handleTemplate} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
              <FileDown size={12} /> Download the import template
            </button>
            , fill it in, then use
            <button type="button" onClick={() => fileInputRef.current?.click()} className="font-semibold text-accent hover:underline">Import Sheet</button>.
          </p>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" disabled={addEmployee.isPending} className="pill-accent px-5 py-2.5 text-sm disabled:opacity-60">
            {addEmployee.isPending ? "Adding…" : "Add employee"}
          </button>
        </form>
      )}

      {/* Filters */}
      <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search size={15} className="shrink-0 text-muted-2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-ink outline-none placeholder:text-muted-2"
            aria-label="Search employees"
          />
          {search && <button onClick={() => setSearch("")} className="text-muted hover:text-ink" aria-label="Clear search"><X size={14} /></button>}
        </div>
        <select className="field appearance-none pr-8" value={filters.status} onChange={(e) => setFilter("status", e.target.value)} aria-label="Status">
          <option value="">Status: All</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {showDepartmentFilter ? (
          <select className="field appearance-none pr-8" value={filters.department} onChange={(e) => setFilter("department", e.target.value)} aria-label="Department">
            <option value="">Department: All</option>
            {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        ) : (
          <div className="field flex items-center text-muted">Your department</div>
        )}
        <select className="field appearance-none pr-8" value={filters.role} onChange={(e) => setFilter("role", e.target.value)} aria-label="Role">
          <option value="">Role: All</option>
          {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {error && !showForm && (
        <div className="rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">{error}</div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-2.5 text-sm">
          <span className="font-medium text-ink">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={handleExport} className="pill-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
              <FileOutput size={13} /> Export selected
            </button>
            {deletableSelected > 0 && (
              <button onClick={handleRemoveSelected} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-danger hover:bg-chip-pink-bg/40">
                <Trash2 size={13} /> Remove {deletableSelected}
              </button>
            )}
            <button onClick={() => setSelected(new Set())} className="text-xs font-semibold text-muted hover:text-ink">Clear</button>
          </div>
        </div>
      )}

      {isLoading && <p className="text-sm text-muted">Loading...</p>}

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {employees.map((emp) => (
          <div key={emp.id} className="card flex items-center gap-3 p-4">
            <Avatar name={emp.name} size="md" />
            <Link to={`/employees/${emp.id}`} className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{emp.name}</p>
              <p className="truncate text-xs text-muted">{emp.designation || ROLE_LABELS[emp.role] || emp.role}</p>
              <p className="mt-0.5 truncate text-xs text-muted-2">
                {emp.department?.name || "No department"}
                {emp.manager?.name ? ` · ${emp.manager.name}` : ""}
                {emp.joiningDate ? ` · ${formatDay(emp.joiningDate)}` : ""}
              </p>
            </Link>
            <div className="flex flex-col items-end gap-2">
              <StatusBadge type="employee" status={emp.status} />
              <div className="flex items-center">
                <a href={`mailto:${emp.email}`} className={actionBtn} aria-label={`Email ${emp.name}`}><Mail size={15} /></a>
                <RowMenu emp={emp} canDelete={canDeleteEmployee(emp)} onRemove={handleRemove} />
              </div>
            </div>
          </div>
        ))}
        {employees.length === 0 && !isLoading && (
          <EmptyState
            title="No employees"
            description={hasFilters ? "No one matches these filters." : "Add your first employee to get started."}
          />
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden card overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-semibold text-muted">
              <tr className="border-b border-border bg-surface-2">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                    aria-label="Select all on this page"
                    className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
                  />
                </th>
                <th className="px-4 py-3"><SortHeader label="Employee" field="name" sort={sort} onSort={toggleSort} /></th>
                <th className="px-4 py-3"><SortHeader label="Status" field="status" sort={sort} onSort={toggleSort} /></th>
                <th className="px-4 py-3"><SortHeader label="Department" field="department" sort={sort} onSort={toggleSort} /></th>
                <th className="px-4 py-3"><SortHeader label="Manager" field="manager" sort={sort} onSort={toggleSort} /></th>
                <th className="px-4 py-3"><SortHeader label="Start Day" field="joiningDate" sort={sort} onSort={toggleSort} /></th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr
                  key={emp.id}
                  className={`border-b border-border last:border-0 transition-colors hover:bg-surface-2 ${selected.has(emp.id) ? "bg-accent-soft" : ""}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(emp.id)}
                      onChange={() => toggleOne(emp.id)}
                      aria-label={`Select ${emp.name}`}
                      className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={emp.name} size="sm" />
                      <div className="min-w-0">
                        <Link to={`/employees/${emp.id}`} className="block truncate font-semibold text-ink hover:text-accent">
                          {emp.name}
                        </Link>
                        <p className="truncate text-xs text-muted">{emp.designation || ROLE_LABELS[emp.role] || emp.role}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge type="employee" status={emp.status} /></td>
                  <td className="px-4 py-3 text-ink">{emp.department?.name || <span className="text-muted-2">—</span>}</td>
                  <td className="px-4 py-3 text-ink">{emp.manager?.name || <span className="text-muted-2">—</span>}</td>
                  <td className="px-4 py-3 text-ink">{emp.joiningDate ? formatDay(emp.joiningDate) : <span className="text-muted-2">—</span>}</td>
                  <td className="px-4 py-3 text-ink">{TYPE_LABELS[emp.workLocationType] || <span className="text-muted-2">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-0.5">
                      <Link to={`/employees/${emp.id}`} className={actionBtn} aria-label={`Edit ${emp.name}`} title="Open / edit profile">
                        <Pencil size={15} />
                      </Link>
                      <a href={`mailto:${emp.email}`} className={actionBtn} aria-label={`Email ${emp.name}`} title={emp.email}>
                        <Mail size={15} />
                      </a>
                      <RowMenu emp={emp} canDelete={canDeleteEmployee(emp)} onRemove={handleRemove} />
                    </div>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-muted">
                    {hasFilters ? "No employees match these filters." : "No employees found."}
                  </td>
                </tr>
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
        onPageChange={(p) => { setPage(p); setSelected(new Set()) }}
      />
      {isFetching && !isLoading && <p className="mt-1 text-center text-xs text-muted-2">Refreshing…</p>}
    </div>
  )
}
