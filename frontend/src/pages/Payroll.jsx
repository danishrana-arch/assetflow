import { Fragment, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Wallet, Play, Send, CheckCircle2, XCircle, Trash2, ChevronLeft, ChevronRight, UserX, Pencil, Plus, Minus, Receipt, Percent, ClipboardCheck } from "lucide-react"
import { Link } from "react-router-dom"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { hasModuleAccess } from "../utils/roles"
import PageHeader from "../components/ui/PageHeader"
import Avatar from "../components/ui/Avatar"
import StatusPill from "../components/ui/StatusPill"
import EmptyState from "../components/ui/EmptyState"
import { TextField, SelectField } from "../components/ui/Field"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const STATUS_TONE = { DRAFT: "slate", PENDING_APPROVAL: "yellow", PAID: "green" }

function money(n) {
  return `PKR ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function Amount({ value, tone, className = "" }) {
  const n = Number(value || 0)
  if (!n) return <span className={`font-mono text-xs text-muted-2 ${className}`}>—</span>
  const color = tone === "add" ? "text-chip-green-fg" : "text-chip-pink-fg"
  return <span className={`font-mono text-xs ${color} ${className}`}>{tone === "add" ? "+" : "−"}{money(n)}</span>
}

function absenceSummary(r) {
  return [
    r.absentDays > 0 ? `${r.absentDays} absent day${r.absentDays === 1 ? "" : "s"}` : null,
    r.unpaidLeaveDays > 0 ?`${r.unpaidLeaveDays} unpaid day${r.unpaidLeaveDays === 1 ? "" : "s"}` : null,
    r.halfDayLeaveDays > 0 ? `${r.halfDayLeaveDays} half-day${r.halfDayLeaveDays === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(", ")
}

function editorStateFor(r, { withTermination = false } = {}) {
  const hasTermination = Boolean(r.terminationDate) || withTermination
  return {
    id: r.id,
    bonus: Number(r.bonus) || 0,
    taxPercent: Number(r.taxPercent) || 0,
    otherDeduction: Number(r.otherDeduction) || "",
    note: r.note || "",
    termination: hasTermination,
    terminationDate: r.terminationDate ? r.terminationDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
    terminationSettlement: Number(r.terminationSettlement) || "",
    terminationDeduction: Number(r.terminationDeduction) || "",
    terminationNote: r.terminationNote || "",
  }
}

const MIN_BONUS = 500
const BONUS_STEP = 500
const TAX_STEP = 1

// [−] value [+] control; typing a value directly also works.
function Stepper({ label, value, onChange, step, min = 0, max, suffix, hint }) {
  const clamp = (n) => Math.max(min, max !== undefined ? Math.min(max, n) : n)
  const num = Number(value) || 0
  const btn = "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface text-ink hover:bg-surface-2 disabled:opacity-40"
  return (
    <div>
      <p className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="flex items-center gap-1.5">
        <button type="button" className={btn} onClick={() => onChange(clamp(num - step))} disabled={num <= min} aria-label={`Decrease ${label}`}>
          <Minus size={14} />
        </button>
        <div className="relative flex-1">
          <input
            type="number"
            min={500}
            max={max}
            step="100"
            value={value}
            onChange={(e) => onChange(e.target.value === "" ? "" : clamp(Number(e.target.value)))}
            className="field pr-9 text-center font-mono"
          />
          {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{suffix}</span>}
        </div>
        <button type="button" className={btn} onClick={() => onChange(clamp(num + step))} disabled={max !== undefined && num >= max} aria-label={`Increase ${label}`}>
          <Plus size={14} />
        </button>
      </div>
      {hint && <p className="mt-1 text-xs text-muted-2">{hint}</p>}
    </div>
  )
}

// Inline editor for a DRAFT payslip: bonus (min 500, ±500 steps), tax as a
// percentage of basic pay, other deductions, plus the optional termination
// section. Absent/late come from attendance and office expenses from
// approved claims, so they're read-only.
function PayslipEditor({ record, state, setState, onSave, onCancel, saving, error }) {
  const set = (key) => (e) => setState((s) => ({ ...s, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }))
  const setValue = (key) => (v) => setState((s) => ({ ...s, [key]: v }))
  const bonus = Number(state.bonus) || 0
  const bonusTooLow = bonus > 0 && bonus < MIN_BONUS
  const taxAmount = (Number(record.baseSalary) * (Number(state.taxPercent) || 0)) / 100
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-canvas p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stepper
          label="Bonus (+)"
          value={state.bonus}
          onChange={setValue("bonus")}
          step={BONUS_STEP}
          hint={bonusTooLow ? <span className="text-chip-pink-fg">Minimum bonus is {money(MIN_BONUS)}</span> : `Min ${money(MIN_BONUS)} · + adds ${BONUS_STEP}`}
        />
        <Stepper
          label="Tax (−)"
          value={state.taxPercent}
          onChange={setValue("taxPercent")}
          step={TAX_STEP}
          max={100}
          suffix="%"
          hint={`Deducts ${money(taxAmount)} of basic pay`}
        />
        <TextField label="Other deductions (−)" type="number" min="0" step="any" placeholder="0" value={state.otherDeduction} onChange={set("otherDeduction")} />
      </div>
      <p className="text-xs text-muted-2">
        Calculated automatically: absent {money(record.absentDeduction)}, late {money(record.lateDeduction)}, attendance fines {money(record.fineDeduction)} (set on the Attendance page), office expenses {money(record.expenseReimbursement)}, performance bonus {money(record.performanceBonus)}.
      </p>
      <TextField label="Note on payslip (optional)" maxLength={1000} value={state.note} onChange={set("note")} />

      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input type="checkbox" checked={state.termination} onChange={set("termination")} className="h-4 w-4 accent-[var(--accent)]" />
        Termination / final settlement
      </label>
      {state.termination && (
        <div className="grid gap-3 rounded-2xl border border-border bg-surface p-3 sm:grid-cols-3">
          <TextField label="Last working day" type="date" value={state.terminationDate} onChange={set("terminationDate")} />
          <TextField label="Settlement (+)" type="number" min="0" step="any" placeholder="0" hint="e.g. gratuity, leave encashment" value={state.terminationSettlement} onChange={set("terminationSettlement")} />
          <TextField label="Termination deduction (−)" type="number" min="0" step="any" placeholder="0" hint="e.g. unserved notice, unreturned asset" value={state.terminationDeduction} onChange={set("terminationDeduction")} />
          <TextField className="sm:col-span-3" label="Termination note (optional)" maxLength={1000} value={state.terminationNote} onChange={set("terminationNote")} />
        </div>
      )}

      {error && <p className="text-xs text-chip-pink-fg">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-full border border-border-strong px-3.5 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2">
          Cancel
        </button>
        <button onClick={onSave} disabled={saving || bonusTooLow} className="rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {saving ? "Saving…" : "Save payslip"}
        </button>
      </div>
    </div>
  )
}

const REVIEW_ACTION = {
  create: { label: "New payslip", tone: "blue" },
  refresh: { label: "Draft — will update", tone: "slate" },
  locked: { label: "Submitted/paid — unchanged", tone: "green" },
}

// Literal class names so Tailwind picks them up.
const ISSUE_TONE = {
  pink: "bg-chip-pink-bg text-chip-pink-fg",
  yellow: "bg-chip-yellow-bg text-chip-yellow-fg",
  slate: "bg-chip-slate-bg text-chip-slate-fg",
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

// "Attendance → payroll" review: what Generate would write for the month,
// straight from GET /payroll/preview (same calculation, nothing written),
// plus the things worth fixing first. Generate itself is the existing
// POST /payroll/generate.
function PayrollReview({ month, year, canGenerate, onGenerate, generating, onClose }) {
  const [onlyIssues, setOnlyIssues] = useState(false)
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["payroll-preview", month, year],
    queryFn: () => api.get("/payroll/preview", { params: { month, year } }).then((r) => r.data),
  })

  const issues = data?.issues
  const issueItems = issues
    ? [
        issues.missingSalary.length > 0 && {
          tone: "pink",
          text: `${plural(issues.missingSalary.length, "active employee")} without a base salary will be skipped`,
          names: issues.missingSalary.map((e) => ({ id: e.id, name: e.name })),
          hint: "Add a salary on their profile, then review again.",
        },
        issues.pendingCorrections.length > 0 && {
          tone: "yellow",
          text: `${plural(issues.pendingCorrections.length, "attendance correction")} waiting for approval`,
          names: issues.pendingCorrections.map((c) => ({ id: c.employeeId, name: c.name })),
          link: { to: "/attendance", label: "Review on Attendance" },
        },
        issues.pendingLeaves.length > 0 && {
          tone: "yellow",
          text: `${plural(issues.pendingLeaves.length, "leave request")} in this month not decided yet`,
          names: issues.pendingLeaves.map((l) => ({ id: l.employeeId, name: `${l.name} (${l.type.toLowerCase()})` })),
          link: { to: "/leave-requests", label: "Review leave requests" },
          hint: "Approved unpaid leave is deducted; pending leave is not.",
        },
        issues.unrecordedDays.length > 0 && {
          tone: "yellow",
          text: `${plural(issues.unrecordedDays.length, "employee")} with past workdays that have no attendance record`,
          names: issues.unrecordedDays.map((e) => ({ id: e.employeeId, name: `${e.name} (${plural(e.count, "day")})` })),
          hint: "Only days marked Absent are deducted — mark these on the Attendance page if they were absences.",
        },
        issues.openCheckOuts.length > 0 && {
          tone: "slate",
          text: `${plural(issues.openCheckOuts.length, "employee")} with a missing check-out`,
          names: issues.openCheckOuts.map((e) => ({ id: e.employeeId, name: `${e.name} (${e.count})` })),
          hint: "Doesn't change pay — shown so worked hours can be corrected.",
        },
      ].filter(Boolean)
    : []

  const rows = (data?.employees || []).filter((e) =>
    !onlyIssues || e.attendance.absent || e.attendance.late || e.attendance.unrecordedDays || e.attendance.openCheckOuts || e.attendance.unpaidLeaveDays
  )
  const toWrite = (data?.totals.create || 0) + (data?.totals.refresh || 0)

  return (
    <div className="mb-4 rounded-card bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink">Attendance review · {MONTHS[month - 1]} {year}</div>
          <p className="mt-0.5 text-xs text-muted">
            What each payslip will be built from — attendance, leave and approved claims already recorded. Nothing is saved until you generate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} disabled={isFetching} className="rounded-full border border-border-strong px-3.5 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2 disabled:opacity-50">
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
          <button onClick={onClose} className="rounded-full border border-border-strong px-3.5 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2">Close</button>
        </div>
      </div>

      {isLoading && <p className="mt-4 text-sm text-muted">Reading attendance for the month…</p>}
      {isError && <p className="mt-4 text-sm text-chip-pink-fg">{error?.response?.data?.error || "Couldn't load the review."}</p>}

      {data && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Working days", value: data.period.workingDays, sub: data.period.holidays ? `${plural(data.period.holidays, "holiday")} excluded` : "Mon–Fri schedule" },
              { label: "Employees", value: data.totals.employees, sub: `${data.totals.create} new · ${data.totals.refresh} draft · ${data.totals.locked} locked` },
              { label: "Absent / late days", value: `${data.totals.absentDays} / ${data.totals.lateDays}`, sub: `${money(data.totals.absentDeduction + data.totals.lateDeduction)} deducted` },
              { label: "Estimated net payout", value: money(data.totals.netPay), sub: "Before any manual edits" },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-border bg-canvas px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-muted">{s.label}</p>
                <p className="mt-0.5 font-mono text-base font-semibold text-ink">{s.value}</p>
                <p className="mt-0.5 text-[11px] text-muted-2">{s.sub}</p>
              </div>
            ))}
          </div>

          {!data.period.isComplete && (
            <p className="mt-3 rounded-2xl bg-chip-yellow-bg px-3 py-2 text-xs text-chip-yellow-fg">
              This month isn't over yet — days still to come aren't counted. You can generate now and press Generate again later; drafts are refreshed with the latest attendance.
            </p>
          )}

          {issueItems.length > 0 ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Check before generating</p>
              {issueItems.map((item) => (
                <div key={item.text} className={`rounded-2xl px-3 py-2 text-xs ${ISSUE_TONE[item.tone]}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{item.text}</span>
                    {item.link && <Link to={item.link.to} className="font-semibold underline">{item.link.label}</Link>}
                  </div>
                  <p className="mt-1 opacity-90">
                    {item.names.slice(0, 8).map((n, i) => (
                      <Fragment key={`${n.id}-${i}`}>{i > 0 && ", "}<Link to={`/employees/${n.id}`} className="hover:underline">{n.name}</Link></Fragment>
                    ))}
                    {item.names.length > 8 && ` and ${item.names.length - 8} more`}
                  </p>
                  {item.hint && <p className="mt-0.5 opacity-80">{item.hint}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-2xl bg-chip-green-bg px-3 py-2 text-xs text-chip-green-fg">No open issues — attendance and leave for this month are settled.</p>
          )}

          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Per employee</p>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
              Only employees with deductions or gaps
            </label>
          </div>
          <div className="mt-2 max-h-[420px] overflow-auto rounded-2xl border border-border">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-semibold">Employee</th>
                  <th className="px-3 py-2 font-semibold">Present</th>
                  <th className="px-3 py-2 font-semibold">Late</th>
                  <th className="px-3 py-2 font-semibold">Absent</th>
                  <th className="px-3 py-2 font-semibold">Leave (paid / unpaid)</th>
                  <th className="px-3 py-2 font-semibold">No record</th>
                  <th className="px-3 py-2 font-semibold">Deductions</th>
                  <th className="px-3 py-2 font-semibold">Additions</th>
                  <th className="px-3 py-2 font-semibold">Net pay</th>
                  <th className="px-3 py-2 font-semibold">On Generate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((e) => {
                  const a = e.attendance
                  const additions = e.bonus + e.performanceBonus + e.expenseReimbursement
                  return (
                    <tr key={e.employeeId}>
                      <td className="px-3 py-2">
                        <Link to={`/employees/${e.employeeId}`} className="font-medium text-ink hover:underline">{e.name}</Link>
                        <div className="text-[11px] text-muted">{e.department || "—"} · base {money(e.baseSalary)}</div>
                      </td>
                      <td className="px-3 py-2 font-mono">{a.present + a.late}</td>
                      <td className="px-3 py-2 font-mono">{a.late || "—"}</td>
                      <td className={`px-3 py-2 font-mono ${a.absent ? "text-chip-pink-fg" : ""}`}>{a.absent || "—"}</td>
                      <td className="px-3 py-2 font-mono">{a.paidLeaveDays || 0} / {a.unpaidLeaveDays || 0}</td>
                      <td className={`px-3 py-2 font-mono ${a.unrecordedDays ? "text-chip-yellow-fg" : ""}`}>{a.unrecordedDays || "—"}</td>
                      <td className="px-3 py-2">
                        <Amount value={e.deductions} tone="deduct" />
                        {(e.absentDeduction > 0 || e.lateDeduction > 0) && (
                          <div className="text-[10px] text-muted">absent {money(e.absentDeduction)} · late {money(e.lateDeduction)}</div>
                        )}
                      </td>
                      <td className="px-3 py-2"><Amount value={additions} tone="add" /></td>
                      <td className="px-3 py-2 font-mono font-semibold text-ink">{money(e.netPay)}</td>
                      <td className="px-3 py-2"><StatusPill tone={REVIEW_ACTION[e.action].tone}>{REVIEW_ACTION[e.action].label}</StatusPill></td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={10} className="px-3 py-6 text-center text-muted">
                    {onlyIssues ? "No one has deductions or attendance gaps this month." : "No employees with a base salary yet — add one from an employee's profile."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {canGenerate && (
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              <p className="text-xs text-muted">
                {toWrite === 0
                  ? "Nothing to generate — every payslip this month is already submitted or paid."
                  : `Creates ${plural(data.totals.create, "payslip")} and updates ${plural(data.totals.refresh, "draft")}. Bonus, tax and other edits on drafts are kept.`}
              </p>
              <button
                onClick={onGenerate}
                disabled={generating || toWrite === 0}
                className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                <Play size={14} /> {generating ? "Generating…" : "Generate payroll"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function Payroll() {
  const { user } = useAuth()
  const canManagePayroll = user?.role === "ADMIN"
  const isCeo = user?.role === "CEO"
  const queryClient = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [editing, setEditing] = useState(null) // PayslipEditor state
  const [showTerminationPicker, setShowTerminationPicker] = useState(false)
  const [terminationEmployeeId, setTerminationEmployeeId] = useState("")
  const [showTaxPanel, setShowTaxPanel] = useState(false)
  const [taxPercentAll, setTaxPercentAll] = useState(0)
  const [showReview, setShowReview] = useState(false)

  const { data: records, isLoading } = useQuery({
    queryKey: ["payroll", month, year],
    queryFn: () => api.get("/payroll", { params: { month, year } }).then((r) => r.data),
  })

  // Pending office-expense claims — the Payroll page is where ADMIN/CEO get
  // to the review page (there's no sidebar entry; HR reaches it from the
  // "New expense claim" notification).
  const { data: pendingClaims } = useQuery({
    queryKey: ["expense-claims", "PENDING"],
    queryFn: () => api.get("/expense-claims", { params: { status: "PENDING" } }).then((r) => r.data),
    enabled: hasModuleAccess(user?.role, "expenseClaims"),
  })

  const { data: employees } = useQuery({
    queryKey: ["employees", "payroll-termination-picker"],
    queryFn: () => api.get("/employees").then((r) => r.data),
    enabled: canManagePayroll && showTerminationPicker,
  })
  const recordByEmployee = useMemo(() => new Map((records || []).map((r) => [r.employeeId, r])), [records])

  const totals = useMemo(() => {
    if (!records) return { net: 0, paid: 0, draft: 0, pending: 0 }
    return records.reduce(
      (acc, r) => ({
        net: acc.net + Number(r.netPay),
        paid: acc.paid + (r.status === "PAID" ? 1 : 0),
        draft: acc.draft + (r.status === "DRAFT" ? 1 : 0),
        pending: acc.pending + (r.status === "PENDING_APPROVAL" ? 1 : 0),
      }),
      { net: 0, paid: 0, draft: 0, pending: 0 }
    )
  }, [records])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payroll", month, year] })
    queryClient.invalidateQueries({ queryKey: ["payroll-preview", month, year] })
  }

  const generate = useMutation({
    mutationFn: () => api.post("/payroll/generate", { month, year }).then((r) => r.data),
    onSuccess: () => { setShowReview(false); invalidate() },
  })

  const save = useMutation({
    mutationFn: (s) =>
      api
        .patch(`/payroll/${s.id}`, {
          bonus: s.bonus,
          taxPercent: s.taxPercent,
          otherDeduction: s.otherDeduction,
          note: s.note,
          ...(s.termination
            ? {
                terminationDate: s.terminationDate,
                terminationSettlement: s.terminationSettlement,
                terminationDeduction: s.terminationDeduction,
                terminationNote: s.terminationNote,
              }
            : { terminationDate: null }),
        })
        .then((r) => r.data),
    onSuccess: () => { setEditing(null); invalidate() },
  })

  const createTerminationPayslip = useMutation({
    mutationFn: (employeeId) => api.post("/payroll/employee", { employeeId, month, year }).then((r) => r.data),
    onSuccess: (record) => {
      setShowTerminationPicker(false)
      setTerminationEmployeeId("")
      invalidate()
      save.reset()
      setEditing(editorStateFor(record, { withTermination: true }))
    },
  })

  const applyTax = useMutation({
    mutationFn: () => api.post("/payroll/tax", { month, year, taxPercent: taxPercentAll }).then((r) => r.data),
    onSuccess: invalidate,
  })

  const markPaid = useMutation({
    mutationFn: (id) => api.post(`/payroll/${id}/mark-paid`).then((r) => r.data),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id) => api.delete(`/payroll/${id}`),
    onSuccess: invalidate,
  })

  // Admin's final step — sends every DRAFT record this month to the CEO.
  const submit = useMutation({
    mutationFn: () => api.post("/payroll/submit", { month, year }).then((r) => r.data),
    onSuccess: invalidate,
  })

  // CEO's sign-off — approves and pays every PENDING_APPROVAL record at
  // once, "delivered to every account" in one click.
  const approveAll = useMutation({
    mutationFn: () => api.post("/payroll/approve", { month, year }).then((r) => r.data),
    onSuccess: invalidate,
  })

  const rejectAll = useMutation({
    mutationFn: () => api.post("/payroll/reject", { month, year }).then((r) => r.data),
    onSuccess: invalidate,
  })

  const deleteAll = useMutation({
    mutationFn: () => api.delete("/payroll/bulk", { data: { month, year } }).then((r) => r.data),
    onSuccess: invalidate,
  })

  function shiftMonth(delta) {
    let m = month + delta
    let y = year
    if (m > 12) { m = 1; y += 1 }
    if (m < 1) { m = 12; y -= 1 }
    setMonth(m); setYear(y)
    setEditing(null); setShowTerminationPicker(false); setShowTaxPanel(false); setShowReview(false)
    generate.reset()
  }

  function handleDeleteAll() {
    if (window.confirm(`Delete every non-paid payslip for ${MONTHS[month - 1]} ${year}? This can't be undone.`)) {
      deleteAll.mutate()
    }
  }

  function startEdit(r, options) {
    save.reset()
    setEditing(editorStateFor(r, options))
  }

  // Existing DRAFT payslip → open it with the termination section on;
  // no payslip yet → create one first (the mutation then opens it).
  function startTermination() {
    const existing = recordByEmployee.get(terminationEmployeeId)
    if (existing) {
      setShowTerminationPicker(false)
      setTerminationEmployeeId("")
      startEdit(existing, { withTermination: true })
    } else {
      createTerminationPayslip.mutate(terminationEmployeeId)
    }
  }

  function openTaxPanel() {
    // Start from the % most drafts already use.
    const counts = new Map()
    for (const r of records || []) {
      if (r.status !== "DRAFT") continue
      const pct = Number(r.taxPercent) || 0
      counts.set(pct, (counts.get(pct) || 0) + 1)
    }
    const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    setTaxPercentAll(common ? common[0] : 0)
    applyTax.reset()
    setShowTerminationPicker(false)
    setShowTaxPanel((v) => !v)
  }

  function renderEditor(r) {
    return (
      <PayslipEditor
        record={r}
        state={editing}
        setState={setEditing}
        onSave={() => save.mutate(editing)}
        onCancel={() => setEditing(null)}
        saving={save.isPending}
        error={save.error?.response?.data?.error}
      />
    )
  }

  function renderActions(r) {
    const isDraft = r.status === "DRAFT"
    const isPaid = r.status === "PAID"
    const isEditing = editing?.id === r.id
    return (
      <div className="flex items-center justify-end gap-1.5">
        {isDraft && canManagePayroll && !isEditing && (
          <button
            onClick={() => startEdit(r)}
            title="Edit bonus, tax and deductions"
            className="flex items-center gap-1 rounded-full border border-border-strong px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2"
          >
            <Pencil size={12} /> Edit
          </button>
        )}
        {!isPaid && isCeo && (
          <button
            onClick={() => markPaid.mutate(r.id)}
            disabled={markPaid.isPending}
            title="Mark this one paid"
            className="flex h-8 w-8 items-center justify-center rounded-full text-chip-green-fg hover:bg-chip-green-bg"
          >
            <CheckCircle2 size={16} />
          </button>
        )}
        {!isPaid && (canManagePayroll || isCeo) && (
          <button
            onClick={() => window.confirm(`Delete ${r.employee?.name}'s payslip?`) && remove.mutate(r.id)}
            disabled={remove.isPending}
            title="Delete record"
            className="flex h-8 w-8 items-center justify-center rounded-full text-chip-pink-fg hover:bg-chip-pink-bg"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    )
  }

  const emptyState = !isLoading && records?.length === 0 && (
    <EmptyState
      icon={Wallet}
      title="No payroll for this month yet"
      description={canManagePayroll
        ? "Click Review & Generate to check this month's attendance, leave and deductions, then create the payslips. Employees without a base salary are skipped — add one from their profile."
        : "Payslips appear here once an admin generates this month's payroll."}
      className="my-4"
    />
  )

  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle="Generate, review, and pay the monthly run in PKR."
        stats={[
          { label: "Net payout", value: money(totals.net), icon: Wallet },
          { label: "Draft", value: totals.draft },
          { label: "Pending approval", value: totals.pending },
          { label: "Paid", value: totals.paid },
        ]}
        actions={
          <>
            <div className="flex items-center gap-1 rounded-full border border-border-strong bg-surface px-1.5 py-1">
              <button onClick={() => shiftMonth(-1)} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2" aria-label="Previous month">
                <ChevronLeft size={15} />
              </button>
              <span className="min-w-[130px] text-center text-sm font-semibold text-ink">
                {MONTHS[month - 1]} {year}
              </span>
              <button onClick={() => shiftMonth(1)} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2" aria-label="Next month">
                <ChevronRight size={15} />
              </button>
            </div>

            {hasModuleAccess(user?.role, "expenseClaims") && (
              <Link
                to="/expense-claims"
                title="Verify office expenses employees paid themselves"
                className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2"
              >
                <Receipt size={14} /> Expense claims
                {pendingClaims?.length > 0 && (
                  <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{pendingClaims.length}</span>
                )}
              </Link>
            )}

            {isCeo && (
              <button
                onClick={() => setShowReview((v) => !v)}
                title="See the attendance and leave behind this month's payslips"
                className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2"
              >
                <ClipboardCheck size={14} /> Attendance review
              </button>
            )}

            {canManagePayroll && (
              <>
                <button
                  onClick={() => { setShowReview((v) => !v); setShowTaxPanel(false); setShowTerminationPicker(false) }}
                  title="Review the month's attendance, leave and deductions, then generate"
                  className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  <Play size={14} />
                  {generate.isPending ? "Generating…" : "Review & Generate"}
                </button>
                <button
                  onClick={openTaxPanel}
                  disabled={totals.draft === 0}
                  title={totals.draft === 0 ? "Generate payroll first" : "Set one tax % for every draft payslip this month"}
                  className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-40"
                >
                  <Percent size={14} /> Tax
                </button>
                <button
                  onClick={() => submit.mutate()}
                  disabled={submit.isPending || totals.draft === 0}
                  title={totals.draft === 0 ? "No draft payslips to submit" : "Send to the CEO for approval"}
                  className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-40"
                >
                  <Send size={14} />
                  {submit.isPending ? "Submitting…" : "Submit for Approval"}
                </button>
              </>
            )}

            {isCeo && (
              <>
                <button
                  onClick={() => approveAll.mutate()}
                  disabled={approveAll.isPending || totals.pending === 0}
                  title={totals.pending === 0 ? "Nothing pending approval" : "Approve and pay everyone at once, from your account"}
                  className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <CheckCircle2 size={14} />
                  {approveAll.isPending ? "Paying…" : "Approve & Pay All"}
                </button>
                <button
                  onClick={() => rejectAll.mutate()}
                  disabled={rejectAll.isPending || totals.pending === 0}
                  className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3.5 py-2 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-40"
                >
                  <XCircle size={14} /> Reject
                </button>
                <button
                  onClick={handleDeleteAll}
                  disabled={deleteAll.isPending || (totals.draft === 0 && totals.pending === 0)}
                  title="Delete every non-paid payslip for this month, in one go"
                  className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3.5 py-2 text-sm font-semibold text-danger hover:bg-chip-pink-bg disabled:opacity-40"
                >
                  <Trash2 size={14} /> Delete All
                </button>
              </>
            )}

            {canManagePayroll && (
              <button
                onClick={() => { setShowTerminationPicker((v) => !v); setShowTaxPanel(false); createTerminationPayslip.reset() }}
                title="Final payslip for an employee who is leaving or has left"
                className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2"
              >
                <UserX size={14} /> Termination
              </button>
            )}
          </>
        }
      />

      {showReview && (canManagePayroll || isCeo) && (
        <PayrollReview
          month={month}
          year={year}
          canGenerate={canManagePayroll}
          onGenerate={() => generate.mutate()}
          generating={generate.isPending}
          onClose={() => setShowReview(false)}
        />
      )}

      {showTaxPanel && canManagePayroll && (
        <div className="mb-4 rounded-card bg-surface p-4 shadow-card">
          <div className="text-sm font-semibold text-ink">Tax · {MONTHS[month - 1]} {year}</div>
          <p className="mt-0.5 text-xs text-muted">
            Deducted from each employee's basic pay on all {totals.draft} draft payslip{totals.draft === 1 ? "" : "s"}. You can still change one
            payslip afterward from its Edit button.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-64">
              <Stepper label="Tax percentage" value={taxPercentAll} onChange={setTaxPercentAll} step={TAX_STEP} max={100} suffix="%" />
            </div>
            <button
              onClick={() => applyTax.mutate()}
              disabled={applyTax.isPending || taxPercentAll === ""}
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {applyTax.isPending ? "Applying…" : "Apply to all drafts"}
            </button>
            <button
              onClick={() => setShowTaxPanel(false)}
              className="rounded-full border border-border-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2"
            >
              Close
            </button>
          </div>
          {applyTax.isError && <p className="mt-2 text-xs text-chip-pink-fg">{applyTax.error?.response?.data?.error}</p>}
          {applyTax.isSuccess && (
            <p className="mt-2 text-xs text-chip-green-fg">
              {applyTax.data.taxPercent}% tax applied to {applyTax.data.updated} payslip{applyTax.data.updated === 1 ? "" : "s"}.
            </p>
          )}
        </div>
      )}

      {showTerminationPicker && canManagePayroll && (
        <div className="mb-4 rounded-card bg-surface p-4 shadow-card">
          <div className="text-sm font-semibold text-ink">Termination payslip · {MONTHS[month - 1]} {year}</div>
          <p className="mt-0.5 text-xs text-muted">
            Pick the employee — their payslip opens with the termination section (last working day, settlement, deduction).
            If they don't have a payslip this month yet (e.g. already marked "Left Company"), one is created.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <SelectField className="sm:w-80" label="Employee" value={terminationEmployeeId} onChange={(e) => setTerminationEmployeeId(e.target.value)}>
              <option value="">{employees ? "Select an employee" : "Loading…"}</option>
              {(employees || []).map((e) => {
                const existing = recordByEmployee.get(e.id)
                return (
                  <option key={e.id} value={e.id} disabled={existing && existing.status !== "DRAFT"}>
                    {e.name}
                    {e.status === "LEFT_COMPANY" ? " (left company)" : ""}
                    {existing && existing.status !== "DRAFT" ? " — payslip already submitted" : ""}
                    {!existing && e.baseSalary == null ? " — no base salary" : ""}
                  </option>
                )
              })}
            </SelectField>
            <button
              onClick={startTermination}
              disabled={!terminationEmployeeId || createTerminationPayslip.isPending}
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {createTerminationPayslip.isPending ? "Creating…" : "Continue"}
            </button>
          </div>
          {createTerminationPayslip.isError && (
            <p className="mt-2 text-xs text-chip-pink-fg">{createTerminationPayslip.error?.response?.data?.error}</p>
          )}
        </div>
      )}

      {generate.data?.message && (
        <div className="mb-4 rounded-2xl bg-chip-yellow-bg px-4 py-3 text-xs text-chip-yellow-fg">
          {generate.data.message}
        </div>
      )}
      {generate.isSuccess && !generate.data?.message && (
        <div className="mb-4 rounded-2xl bg-chip-green-bg px-4 py-3 text-xs text-chip-green-fg">
          {generate.data.created} payslip(s) created
          {generate.data.refreshed ? `, ${generate.data.refreshed} draft(s) updated with the latest attendance` : ""}
          {generate.data.skipped ? `, ${generate.data.skipped} already submitted/paid (unchanged)` : ""}.
        </div>
      )}
      {(generate.isError || submit.isError || approveAll.isError || rejectAll.isError || deleteAll.isError) && (
        <div className="mb-4 rounded-2xl bg-chip-pink-bg px-4 py-3 text-xs text-chip-pink-fg">
          {generate.error?.response?.data?.error || (generate.isError && "Couldn't generate payroll — please try again.") || submit.error?.response?.data?.error ||approveAll.error?.response?.data?.error || rejectAll.error?.response?.data?.error || deleteAll.error?.response?.data?.error}
        </div>
      )}
      {approveAll.isSuccess && (
        <div className="mb-4 rounded-2xl bg-chip-green-bg px-4 py-3 text-xs text-chip-green-fg">
          {approveAll.data.paid} payslip(s) approved and delivered to every account.
        </div>
      )}

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {(records || []).map((r) => (
          <div key={r.id} className="card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar name={r.employee?.name} size="sm" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{r.employee?.name}</div>
                  <div className="truncate text-xs text-muted">{r.employee?.department?.name || "—"}</div>
                </div>
              </div>
              <StatusPill tone={STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</StatusPill>
            </div>

            {r.terminationDate && (
              <div className="mt-2"><StatusPill tone="orange" icon={UserX}>Termination</StatusPill></div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div><p className="text-muted-2">Base</p><p className="font-mono text-ink">{money(r.baseSalary)}</p></div>
              <div><p className="text-muted-2">Tax{Number(r.taxPercent) > 0 ? ` (${Number(r.taxPercent)}%)` : ""}</p><Amount value={r.tax} tone="deduct" /></div>
              <div><p className="text-muted-2">Bonus</p><Amount value={r.bonus} tone="add" /></div>
              {Number(r.performanceBonus) > 0 && <div><p className="text-muted-2">Performance bonus</p><Amount value={r.performanceBonus} tone="add" /></div>}
              <div><p className="text-muted-2">Office expenses</p><Amount value={r.expenseReimbursement} tone="add" /></div>
              <div><p className="text-muted-2">Absent{absenceSummary(r) ? ` (${absenceSummary(r)})` : ""}</p><Amount value={r.absentDeduction} tone="deduct" /></div>
              <div><p className="text-muted-2">Late{r.lateDays ? ` (${r.lateDays})` : ""}</p><Amount value={r.lateDeduction} tone="deduct" /></div>
              {Number(r.fineDeduction) > 0 && <div><p className="text-muted-2">Attendance fines</p><Amount value={r.fineDeduction} tone="deduct" /></div>}
              {Number(r.otherDeduction) > 0 && <div><p className="text-muted-2">Other</p><Amount value={r.otherDeduction} tone="deduct" /></div>}
              {Number(r.terminationSettlement) > 0 && <div><p className="text-muted-2">Settlement</p><Amount value={r.terminationSettlement} tone="add" /></div>}
              {Number(r.terminationDeduction) > 0 && <div><p className="text-muted-2">Termination ded.</p><Amount value={r.terminationDeduction} tone="deduct" /></div>}
              <div className="col-span-2 flex items-baseline justify-between border-t border-border pt-2">
                <p className="text-muted-2">Total</p>
                <p className="font-mono text-sm font-semibold text-ink">{money(r.netPay)}</p>
              </div>
            </div>

            <div className="mt-3 text-xs">
              <p className="text-muted-2">Bank</p>
              <p className="text-ink">{r.bankName || "—"}</p>
              <p className="font-mono text-[11px] text-muted">{r.bankAccountNumber || "No account on file"}</p>
            </div>

            {editing?.id === r.id ? <div className="mt-3">{renderEditor(r)}</div> : <div className="mt-3">{renderActions(r)}</div>}
          </div>
        ))}
        {emptyState}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-card bg-surface shadow-card md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Employee</th>
                <th className="px-4 py-3 font-semibold">Bank Account</th>
                <th className="px-4 py-3 font-semibold">Base</th>
                <th className="px-4 py-3 font-semibold">Tax</th>
                <th className="px-4 py-3 font-semibold">Bonus</th>
                <th className="px-4 py-3 font-semibold">Absent</th>
                <th className="px-4 py-3 font-semibold">Late</th>
                <th className="px-4 py-3 font-semibold">Expenses</th>
                <th className="px-4 py-3 font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(records || []).map((r) => (
                <Fragment key={r.id}>
                  <tr className="align-middle">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.employee?.name} size="sm" />
                        <div>
                          <div className="font-medium text-ink">{r.employee?.name}</div>
                          <div className="text-xs text-muted">{r.employee?.department?.name || "—"}</div>
                          {r.terminationDate && (
                            <div className="mt-1"><StatusPill tone="orange" icon={UserX}>Termination</StatusPill></div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-ink">{r.bankName || "—"}</div>
                      <div className="font-mono text-[11px] text-muted">{r.bankAccountNumber || "No account on file"}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink">{money(r.baseSalary)}</td>
                    <td className="px-4 py-3">
                      <Amount value={r.tax} tone="deduct" />
                      {Number(r.taxPercent) > 0 && <div className="text-[11px] text-muted">{Number(r.taxPercent)}%</div>}
                    </td>
                    <td className="px-4 py-3">
                      <Amount value={r.bonus} tone="add" />
                      {Number(r.performanceBonus) > 0 && (
                        <div className="text-[11px] text-muted">performance <Amount value={r.performanceBonus} tone="add" /></div>
                      )}
                      {Number(r.terminationSettlement) > 0 && (
                        <div className="text-[11px] text-muted">settlement <Amount value={r.terminationSettlement} tone="add" /></div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Amount value={r.absentDeduction} tone="deduct" />
                      {absenceSummary(r) && <div className="text-[11px] text-muted">{absenceSummary(r)}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <Amount value={r.lateDeduction} tone="deduct" />
                      {r.lateDays > 0 && <div className="text-[11px] text-muted">{r.lateDays} day{r.lateDays === 1 ? "" : "s"}</div>}
                      {Number(r.fineDeduction) > 0 && (
                        <div className="text-[11px] text-muted">fines <Amount value={r.fineDeduction} tone="deduct" /></div>
                      )}
                      {Number(r.otherDeduction) > 0 && (
                        <div className="text-[11px] text-muted">other <Amount value={r.otherDeduction} tone="deduct" /></div>
                      )}
                      {Number(r.terminationDeduction) > 0 && (
                        <div className="text-[11px] text-muted">termination <Amount value={r.terminationDeduction} tone="deduct" /></div>
                      )}
                    </td>
                    <td className="px-4 py-3"><Amount value={r.expenseReimbursement} tone="add" /></td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-ink">{money(r.netPay)}</td>
                    <td className="px-4 py-3">
                      <StatusPill tone={STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</StatusPill>
                    </td>
                    <td className="px-4 py-3">{renderActions(r)}</td>
                  </tr>
                  {editing?.id === r.id && (
                    <tr>
                      <td colSpan={11} className="px-4 pb-4 pt-0">{renderEditor(r)}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {emptyState}
      </div>
    </div>
  )
}
