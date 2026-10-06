import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, FileBarChart, FileSpreadsheet, FileText, Loader2, Play, Printer, SearchX } from "lucide-react"
import api from "../api/client"
import SectionHeader from "./ui/SectionHeader"
import EmptyState from "./ui/EmptyState"
import { SelectField, TextField } from "./ui/Field"

// "Generate HR Report" panel for the HR Reports page. All data comes from
// GET /reports/hr (backend: hr-report.controller.js), which also enforces
// which organizations the caller may report on. Exports re-request the
// exact filters used for the last generated preview.

const REPORT_TYPES = [
  { value: "attendance", label: "Attendance Report", needsDates: true },
  { value: "employees", label: "Employee Report", needsDates: false },
  { value: "leave", label: "Leave Report", needsDates: true },
  { value: "late-absence", label: "Late & Absence Report", needsDates: true },
  { value: "anomalies", label: "Attendance Anomalies Report", needsDates: true },
  { value: "headcount", label: "Headcount Report", needsDates: false },
  { value: "payroll-adjustments", label: "Payroll Adjustments Report", needsDates: true },
  { value: "site-admin-activity", label: "Site Admin Activity Report", needsDates: true },
]

// Which extra filters each report type shows.
const EXTRA_FILTERS = {
  attendance: ["status", "siteId", "projectId", "markedById", "siteAdminOnly"],
  "late-absence": ["lateStatus", "siteId", "projectId"],
  anomalies: ["anomalyStatus", "siteId"],
  leave: ["leaveStatus", "leaveType"],
  employees: ["employeeStatus"],
  headcount: [],
  "payroll-adjustments": [],
  "site-admin-activity": ["siteId", "projectId", "siteAdminId"],
}
const NO_EMPLOYEE_FILTER = new Set(["headcount"])

function isoDay(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`
}

function initialFilters() {
  const now = new Date()
  return {
    type: "attendance",
    from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: isoDay(now),
    organizationId: "",
    departmentId: "",
    employeeId: "",
    status: "",
    siteId: "",
    leaveStatus: "",
    leaveType: "",
    anomalyStatus: "",
    employeeStatus: "",
    projectId: "",
    markedById: "",
    siteAdminOnly: false,
    siteAdminId: "",
  }
}

// Only send the params that apply to the chosen report type.
function buildParams(f) {
  const extras = EXTRA_FILTERS[f.type] || []
  const p = { type: f.type }
  if (f.from) p.from = f.from
  if (f.to) p.to = f.to
  if (f.organizationId) p.organizationId = f.organizationId
  if (f.departmentId) p.departmentId = f.departmentId
  if (f.employeeId && !NO_EMPLOYEE_FILTER.has(f.type)) p.employeeId = f.employeeId
  if (extras.includes("status") && f.status) p.status = f.status
  if (extras.includes("lateStatus") && f.status) p.status = f.status
  if (extras.includes("siteId") && f.siteId) p.siteId = f.siteId
  if (extras.includes("leaveStatus") && f.leaveStatus) p.leaveStatus = f.leaveStatus
  if (extras.includes("leaveType") && f.leaveType) p.leaveType = f.leaveType
  if (extras.includes("anomalyStatus") && f.anomalyStatus) p.anomalyStatus = f.anomalyStatus
  if (extras.includes("employeeStatus") && f.employeeStatus) p.employeeStatus = f.employeeStatus
  if (extras.includes("projectId") && f.projectId) p.projectId = f.projectId
  if (extras.includes("markedById") && f.markedById) p.markedById = f.markedById
  if (extras.includes("siteAdminOnly") && f.siteAdminOnly) p.siteAdminOnly = "1"
  if (extras.includes("siteAdminId") && f.siteAdminId) p.markedById = f.siteAdminId
  return p
}

async function errorMessage(err, fallback) {
  const data = err?.response?.data
  if (data instanceof Blob) {
    try { return JSON.parse(await data.text()).error || fallback } catch { return fallback }
  }
  return data?.error || fallback
}

// Row highlight: late → yellow, absent → red. The backend sends the same
// classification as `_tone` (and uses it for Excel fills).
const TONE_STYLE = {
  late: { backgroundColor: "rgba(250, 204, 21, 0.22)" },
  absent: { backgroundColor: "rgba(239, 68, 68, 0.18)" },
}
const TONE_PRINT = { late: "#fff4cc", absent: "#fde2e2" }

function groupByDate(rows) {
  const groups = new Map()
  for (const r of rows) {
    const key = r.date || "No date"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  return [...groups.entries()].map(([date, items]) => ({ date, rows: items }))
}

function formatDay(key) {
  const d = new Date(`${key}T00:00:00`)
  if (Number.isNaN(+d)) return key
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
}

export default function HrReportGenerator() {
  const [filters, setFilters] = useState(initialFilters)
  const [report, setReport] = useState(null)
  const [lastParams, setLastParams] = useState(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState("")
  const [error, setError] = useState("")
  const [dayIndex, setDayIndex] = useState(0)

  const dayGroups = useMemo(() => (report?.groupBy === "date" ? groupByDate(report.rows) : null), [report])
  const currentDay = dayGroups ? dayGroups[Math.min(dayIndex, dayGroups.length - 1)] : null
  const visibleRows = currentDay ? currentDay.rows : report?.rows || []
  const hasTones = (report?.rows || []).some((r) => r._tone)

  const { data: options } = useQuery({
    queryKey: ["hr-report-options"],
    queryFn: () => api.get("/reports/hr/options").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const orgs = options?.organizations || []
  const orgId = filters.organizationId || (orgs.length === 1 ? orgs[0].id : "")
  const inOrg = (item) => !orgId || orgId === "all" || item.organizationId === orgId
  const departments = useMemo(() => (options?.departments || []).filter(inOrg), [options, orgId])
  const employees = useMemo(
    () => (options?.employees || []).filter((e) => inOrg(e) && (!filters.departmentId || e.departmentId === filters.departmentId)),
    [options, orgId, filters.departmentId]
  )
  const sites = useMemo(() => (options?.sites || []).filter(inOrg), [options, orgId])
  const projects = useMemo(() => (options?.projects || []).filter(inOrg), [options, orgId])
  const markers = useMemo(() => (options?.markers || []).filter(inOrg), [options, orgId])
  const siteAdmins = useMemo(() => (options?.siteAdmins || []).filter(inOrg), [options, orgId])

  const typeMeta = REPORT_TYPES.find((t) => t.value === filters.type)
  const extras = EXTRA_FILTERS[filters.type] || []

  function set(key, value) {
    setFilters((f) => {
      const next = { ...f, [key]: value }
      // Keep dependent selections valid.
      if (key === "organizationId") { next.departmentId = ""; next.employeeId = ""; next.siteId = "" }
      if (key === "departmentId") next.employeeId = ""
      if (key === "type") { next.status = ""; next.siteId = ""; next.projectId = ""; next.markedById = ""; next.siteAdminOnly = false; next.siteAdminId = "" }
      return next
    })
  }

  function validate() {
    if (typeMeta?.needsDates && (!filters.from || !filters.to)) return "Select both 'Date From' and 'Date To' for this report."
    if (filters.from && filters.to && filters.from > filters.to) return "'Date From' must be on or before 'Date To'."
    return ""
  }

  async function generate(e) {
    e?.preventDefault()
    const problem = validate()
    if (problem) { setError(problem); return }
    setError("")
    setLoading(true)
    const params = buildParams({ ...filters, organizationId: orgId || filters.organizationId })
    try {
      const { data } = await api.get("/reports/hr", { params })
      setReport(data)
      setDayIndex(0)
      setLastParams(params)
    } catch (err) {
      setReport(null)
      setError(await errorMessage(err, "Could not generate the report."))
    } finally {
      setLoading(false)
    }
  }

  async function download(format) {
    if (!lastParams) return
    setExporting(format)
    setError("")
    try {
      const { data } = await api.get("/reports/hr", { params: { ...lastParams, format }, responseType: "blob" })
      const name = `${report.title.replace(/[^A-Za-z]+/g, "_")}${lastParams.from ? `_${lastParams.from}_${lastParams.to}` : ""}.${format}`
      const url = URL.createObjectURL(data)
      const a = document.createElement("a")
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      setError(await errorMessage(err, `Could not export ${format.toUpperCase()}.`))
    } finally {
      setExporting("")
    }
  }

  function printReport() {
    if (!report) return
    const w = window.open("", "_blank")
    if (!w) { setError("Allow pop-ups to print the report."); return }
    const head = report.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")
    const rowHtml = (r) =>
      `<tr${r._tone ? ` style="background:${TONE_PRINT[r._tone]}"` : ""}>${report.columns.map((c) => `<td>${escapeHtml(r[c.key])}</td>`).join("")}</tr>`
    const table = (rows) => `<table><thead><tr>${head}</tr></thead><tbody>${rows.map(rowHtml).join("")}</tbody></table>`
    // Date-grouped reports print one section per date, each on its own page.
    const body = dayGroups
      ? dayGroups.map((g, i) => `<section${i ? ' class="day"' : ""}><h2>${escapeHtml(formatDay(g.date))} <small>(${g.rows.length})</small></h2>${table(g.rows)}</section>`).join("")
      : table(report.rows)
    const legend = hasTones ? `<p class="legend"><span style="background:${TONE_PRINT.late}">Late</span><span style="background:${TONE_PRINT.absent}">Absent</span></p>` : ""
    const meta = Object.entries(report.meta).map(([k, v]) => `<span><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</span>`).join("")
    w.document.write(`<!doctype html><html><head><title>${escapeHtml(report.title)}</title><style>
      body{font-family:Arial,sans-serif;color:#1f2937;margin:24px} h1{font-size:18px;margin:0 0 6px}
      .meta{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:11px;color:#4b5563;margin-bottom:12px}
      table{border-collapse:collapse;width:100%;font-size:10px} th,td{border:1px solid #d1d5db;padding:4px 6px;text-align:left;vertical-align:top}
      th{background:#f3f4f6} .note{font-size:11px;color:#b45309;margin-top:8px} @page{size:landscape;margin:12mm}
      h2{font-size:13px;margin:14px 0 6px} h2 small{font-weight:normal;color:#6b7280} .day{break-before:page}
      .legend{font-size:11px;margin:0 0 8px} .legend span{display:inline-block;padding:2px 8px;margin-right:6px;border:1px solid #d1d5db}
      tr{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      </style></head><body><h1>${escapeHtml(report.title)}</h1><div class="meta">${meta}</div>${legend}
      ${body}
      ${report.truncated ? `<p class="note">Showing the first ${report.rows.length} of ${report.total} records — use Export CSV/Excel for the full report.</p>` : ""}
      </body></html>`)
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <div className="card p-5">
      <SectionHeader title="Generate HR Report" />
      <form onSubmit={generate} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField label="Report type" value={filters.type} onChange={(e) => set("type", e.target.value)}>
            {REPORT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </SelectField>
          <TextField
            label={`Date from${typeMeta?.needsDates ? " *" : ""}`}
            type="date"
            value={filters.from}
            onChange={(e) => set("from", e.target.value)}
            hint={!typeMeta?.needsDates ? (filters.type === "employees" ? "Optional — filters by joining date" : "Optional") : undefined}
          />
          <TextField
            label={`Date to${typeMeta?.needsDates ? " *" : ""}`}
            type="date"
            value={filters.to}
            onChange={(e) => set("to", e.target.value)}
            hint={!typeMeta?.needsDates ? (filters.type === "headcount" ? "Optional — headcount as of this date" : "Optional") : undefined}
          />
          <SelectField
            label="Organization"
            value={orgId}
            onChange={(e) => set("organizationId", e.target.value)}
            disabled={orgs.length <= 1}
          >
            {orgs.length > 1 && <option value="all">All authorized organizations</option>}
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </SelectField>
          <SelectField label="Department" value={filters.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </SelectField>
          {!NO_EMPLOYEE_FILTER.has(filters.type) && (
            <SelectField label="Employee" value={filters.employeeId} onChange={(e) => set("employeeId", e.target.value)}>
              <option value="">All employees</option>
              {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}{emp.status === "LEFT_COMPANY" ? " (left)" : ""}</option>)}
            </SelectField>
          )}
          {extras.includes("status") && (
            <SelectField label="Attendance status" value={filters.status} onChange={(e) => set("status", e.target.value)}>
              <option value="">All statuses</option>
              <option value="PRESENT">Present</option>
              <option value="LATE">Late</option>
              <option value="ABSENT">Absent</option>
              <option value="LEAVE">Leave</option>
              <option value="FULL_DAY">Full day</option>
              <option value="HALF_DAY">Half day</option>
              <option value="EARLY_GOING">Early going / very short day</option>
            </SelectField>
          )}
          {extras.includes("lateStatus") && (
            <SelectField label="Show" value={filters.status} onChange={(e) => set("status", e.target.value)}>
              <option value="">Late and absent</option>
              <option value="ABSENT">Absences only</option>
            </SelectField>
          )}
          {extras.includes("siteId") && sites.length > 0 && (
            <SelectField label="Attendance site" value={filters.siteId} onChange={(e) => set("siteId", e.target.value)}>
              <option value="">All sites</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
          )}
          {extras.includes("projectId") && projects.length > 0 && (
            <SelectField label="Project" value={filters.projectId} onChange={(e) => set("projectId", e.target.value)}>
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SelectField>
          )}
          {extras.includes("markedById") && (
            <SelectField label="Marked by" value={filters.markedById} onChange={(e) => set("markedById", e.target.value)}>
              <option value="">Anyone</option>
              {markers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role === "SITE_ADMIN" ? " (Site Admin)" : ""}</option>)}
            </SelectField>
          )}
          {extras.includes("siteAdminId") && (
            <SelectField label="Site Admin" value={filters.siteAdminId} onChange={(e) => set("siteAdminId", e.target.value)}>
              <option value="">All Site Admins</option>
              {siteAdmins.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </SelectField>
          )}
          {extras.includes("siteAdminOnly") && (
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-medium text-ink">
              <input type="checkbox" checked={!!filters.siteAdminOnly} onChange={(e) => set("siteAdminOnly", e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
              Only marked by a Site Admin
            </label>
          )}
          {extras.includes("anomalyStatus") && (
            <SelectField label="Anomaly status" value={filters.anomalyStatus} onChange={(e) => set("anomalyStatus", e.target.value)}>
              <option value="">Open and resolved</option>
              <option value="OPEN">Open</option>
              <option value="RESOLVED">Resolved</option>
            </SelectField>
          )}
          {extras.includes("leaveStatus") && (
            <SelectField label="Leave status" value={filters.leaveStatus} onChange={(e) => set("leaveStatus", e.target.value)}>
              <option value="">All statuses</option>
              <option value="PENDING">Pending (any stage)</option>
              <option value="PENDING_HR">Pending HR</option>
              <option value="PENDING_FINAL_APPROVAL">Pending final approval</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </SelectField>
          )}
          {extras.includes("leaveType") && (
            <SelectField label="Leave type" value={filters.leaveType} onChange={(e) => set("leaveType", e.target.value)}>
              <option value="">All types</option>
              <option value="ANNUAL">Annual</option>
              <option value="CASUAL">Casual</option>
              <option value="SICK">Sick</option>
              <option value="UNPAID">Unpaid</option>
            </SelectField>
          )}
          {extras.includes("employeeStatus") && (
            <SelectField label="Employment status" value={filters.employeeStatus} onChange={(e) => set("employeeStatus", e.target.value)}>
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ON_LEAVE">On leave</option>
              <option value="LEFT_COMPANY">Left company</option>
            </SelectField>
          )}
        </div>

        {error && <p role="alert" className="rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">{error}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={loading} className="pill-accent inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-60">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {loading ? "Generating…" : "Generate Report"}
          </button>
          <ExportButton icon={FileText} label="Export CSV" busy={exporting === "csv"} disabled={!report || !report.total || !!exporting} onClick={() => download("csv")} />
          <ExportButton icon={FileSpreadsheet} label="Export Excel" busy={exporting === "xlsx"} disabled={!report || !report.total || !!exporting} onClick={() => download("xlsx")} />
          <ExportButton icon={Printer} label="Print / PDF" disabled={!report || !report.total} onClick={printReport} />
        </div>
      </form>

      {report && (
        <div className="mt-5 border-t border-border pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-ink">{report.title}</p>
              <p className="text-xs text-muted">
                {report.meta.Organization}
                {report.meta["Date from"] !== "—" ? ` · ${report.meta["Date from"]} to ${report.meta["Date to"]}` : ""}
              </p>
            </div>
            <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-ink">
              {report.total} {report.total === 1 ? "record" : "records"}
            </span>
          </div>

          {report.summary && Object.keys(report.summary).length > 0 && report.total > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(report.summary).map(([k, v]) => (
                <span key={k} className="rounded-full border border-border px-3 py-1 text-[11px] text-muted">
                  {k.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}: <b className="text-ink">{v}</b>
                </span>
              ))}
            </div>
          )}

          {report.total === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No records match these filters"
              description="Try widening the date range or clearing the department, employee, or status filters."
              className="mt-4"
            />
          ) : (
            <>
              {(dayGroups || hasTones) && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  {dayGroups ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDayIndex((i) => Math.max(0, i - 1))}
                        disabled={dayIndex === 0}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-ink hover:bg-surface-2 disabled:opacity-40"
                        aria-label="Previous date"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <select
                        value={Math.min(dayIndex, dayGroups.length - 1)}
                        onChange={(e) => setDayIndex(Number(e.target.value))}
                        className="field h-8 w-auto py-0 text-xs"
                        aria-label="Report date"
                      >
                        {dayGroups.map((g, i) => (
                          <option key={g.date} value={i}>{formatDay(g.date)} ({g.rows.length})</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setDayIndex((i) => Math.min(dayGroups.length - 1, i + 1))}
                        disabled={dayIndex >= dayGroups.length - 1}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-ink hover:bg-surface-2 disabled:opacity-40"
                        aria-label="Next date"
                      >
                        <ChevronRight size={16} />
                      </button>
                      <span className="text-xs text-muted">
                        Day {Math.min(dayIndex, dayGroups.length - 1) + 1} of {dayGroups.length} · {currentDay.rows.length} {currentDay.rows.length === 1 ? "record" : "records"}
                      </span>
                    </div>
                  ) : <span />}
                  {hasTones && (
                    <div className="flex items-center gap-3 text-[11px] text-muted">
                      <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded" style={TONE_STYLE.late} /> Late</span>
                      <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded" style={TONE_STYLE.absent} /> Absent</span>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-3 max-h-[520px] overflow-auto rounded-2xl border border-border">
                <table className="w-full min-w-max text-left text-xs">
                  <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
                    <tr>{report.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2 font-semibold">{c.label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleRows.map((row, i) => (
                      <tr key={i} className={row._tone ? "" : "hover:bg-surface-2/60"} style={TONE_STYLE[row._tone]} data-tone={row._tone || undefined}>
                        {report.columns.map((c) => (
                          <td key={c.key} className="whitespace-nowrap px-3 py-2 text-ink">{row[c.key] === "" || row[c.key] == null ? <span className="text-muted-2">—</span> : String(row[c.key])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.truncated && (
                <p className="mt-2 text-xs text-muted">
                  Previewing the first {report.rows.length} of {report.total} records. Export Excel for the complete report (one sheet per date).
                </p>
              )}
            </>
          )}
        </div>
      )}

      {!report && !loading && (
        <EmptyState
          icon={FileBarChart}
          title="Choose a report and click Generate"
          description="Reports are built from live attendance, employee, and leave data for the organizations you can access."
          className="mt-5"
        />
      )}
    </div>
  )
}

function ExportButton({ icon: Icon, label, busy, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
      {label}
    </button>
  )
}
