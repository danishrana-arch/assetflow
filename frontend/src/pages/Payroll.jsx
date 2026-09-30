import { Fragment, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Wallet, Play, Send, CheckCircle2, XCircle, Trash2, ChevronLeft, ChevronRight, UserX, Pencil, Plus, Minus, Receipt, Percent } from "lucide-react"
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
            min={min}
            max={max}
            step="any"
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
        Calculated automatically: absent {money(record.absentDeduction)}, late {money(record.lateDeduction)}, office expenses {money(record.expenseReimbursement)}.
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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["payroll", month, year] })

  const generate = useMutation({
    mutationFn: () => api.post("/payroll/generate", { month, year }).then((r) => r.data),
    onSuccess: invalidate,
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
    setEditing(null); setShowTerminationPicker(false); setShowTaxPanel(false)
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
      description="Generate it from active employees with a base salary set. Employees without a base salary are skipped — add one from their profile."
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

            {canManagePayroll && (
              <>
                <button
                  onClick={() => generate.mutate()}
                  disabled={generate.isPending}
                  className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  <Play size={14} />
                  {generate.isPending ? "Generating…" : "Generate"}
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
              <div><p className="text-muted-2">Office expenses</p><Amount value={r.expenseReimbursement} tone="add" /></div>
              <div><p className="text-muted-2">Absent{absenceSummary(r) ? ` (${absenceSummary(r)})` : ""}</p><Amount value={r.absentDeduction} tone="deduct" /></div>
              <div><p className="text-muted-2">Late{r.lateDays ? ` (${r.lateDays})` : ""}</p><Amount value={r.lateDeduction} tone="deduct" /></div>
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
