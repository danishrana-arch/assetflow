import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { TrendingUp, TrendingDown, History, Pencil } from "lucide-react"
import api from "../api/client"
import Avatar from "./ui/Avatar"
import { TextField, SelectField } from "./ui/Field"

// Salary increments / decrements + their history (SalaryRevision). Used on
// the Payroll page (any employee) and the Employee Profile (one employee).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const MIN_BASE_SALARY = 25000

function pkr(n) {
  return `PKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

// The last 13 months, newest first — the backend accepts this month and up
// to 12 months back.
function effectiveMonthOptions() {
  const now = new Date()
  const out = []
  for (let i = 0; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({ value: `${d.getFullYear()}-${d.getMonth() + 1}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}${i === 0 ? " (this month)" : ""}` })
  }
  return out
}

export function invalidateSalaryQueries(queryClient, employeeId) {
  queryClient.invalidateQueries({ queryKey: ["salary-revisions"] })
  queryClient.invalidateQueries({ queryKey: ["payroll"] })
  queryClient.invalidateQueries({ queryKey: ["payroll-preview"] })
  queryClient.invalidateQueries({ queryKey: ["employees"] })
  if (employeeId) queryClient.invalidateQueries({ queryKey: ["employee", employeeId] })
}

// `employee` fixes the employee (profile); otherwise `employees` gives a picker.
export function SalaryRevisionForm({ employee, employees, onDone, onCancel }) {
  const queryClient = useQueryClient()
  const months = useMemo(effectiveMonthOptions, [])
  const [employeeId, setEmployeeId] = useState(employee?.id || "")
  const [direction, setDirection] = useState("INCREMENT")
  const [mode, setMode] = useState("AMOUNT")
  const [value, setValue] = useState("")
  const [effective, setEffective] = useState(months[0].value)
  const [reason, setReason] = useState("")

  const target = employee || (employees || []).find((e) => e.id === employeeId)
  const current = target?.baseSalary == null || target?.baseSalary === "" ? null : Number(target.baseSalary)
  const v = Number(value) || 0
  const change = current == null ? 0 : Math.round((mode === "AMOUNT" ? v : (current * v) / 100) * 100) / 100
  const next = current == null ? null : direction === "INCREMENT" ? current + change : current - change
  const tooLow = next != null && change > 0 && next < MIN_BASE_SALARY

  const save = useMutation({
    mutationFn: () => {
      const [y, m] = effective.split("-").map(Number)
      return api.post("/payroll/salary-revisions", { employeeId, direction, mode, value: v, effectiveMonth: m, effectiveYear: y, reason }).then((r) => r.data)
    },
    onSuccess: (data) => {
      invalidateSalaryQueries(queryClient, employeeId)
      setValue("")
      setReason("")
      onDone?.(data)
    },
  })

  const canSubmit = employeeId && current != null && change > 0 && !tooLow && reason.trim().length >= 3 && !save.isPending
  const isUp = direction === "INCREMENT"

  return (
    <div className="space-y-3">
      {!employee && (
        <SelectField label="Employee" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); save.reset() }}>
          <option value="">{employees ? "Select an employee" : "Loading…"}</option>
          {(employees || []).map((e) => (
            <option key={e.id} value={e.id} disabled={e.baseSalary == null}>
              {e.name} — {e.baseSalary == null ? "no base salary" : pkr(e.baseSalary)}
            </option>
          ))}
        </SelectField>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="flex rounded-full border border-border-strong bg-surface p-0.5">
          {[["INCREMENT", "Increment", TrendingUp], ["DECREMENT", "Decrement", TrendingDown]].map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setDirection(key)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                direction === key ? (key === "INCREMENT" ? "bg-chip-green-bg text-chip-green-fg" : "bg-chip-pink-bg text-chip-pink-fg") : "text-muted hover:text-ink"
              }`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-full border border-border-strong bg-surface p-0.5">
          {[["AMOUNT", "Amount (PKR)"], ["PERCENT", "Percentage (%)"]].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${mode === key ? "bg-accent text-on-accent" : "text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={mode === "AMOUNT" ? `${isUp ? "Increase" : "Decrease"} by (PKR)` : `${isUp ? "Increase" : "Decrease"} by (%)`}
          type="number"
          min="0"
          step="any"
          placeholder={mode === "AMOUNT" ? "e.g. 5000" : "e.g. 10"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <SelectField label="Effective from" value={effective} onChange={(e) => setEffective(e.target.value)}>
          {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </SelectField>
      </div>
      <TextField label="Reason (kept in the history)" maxLength={500} placeholder="e.g. Annual appraisal 2026" value={reason} onChange={(e) => setReason(e.target.value)} />

      {current != null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-surface-2 px-4 py-3 text-sm">
          <span className="text-muted">Current <span className="font-mono text-ink">{pkr(current)}</span></span>
          <span className="text-muted-2">→</span>
          <span className="text-muted">New <span className={`font-mono font-semibold ${tooLow ? "text-chip-pink-fg" : "text-ink"}`}>{pkr(next)}</span></span>
          {change > 0 && (
            <span className={`font-mono text-xs ${isUp ? "text-chip-green-fg" : "text-chip-pink-fg"}`}>
              {isUp ? "+" : "−"}{pkr(change)}{mode === "PERCENT" ? ` (${v}%)` : current ? ` (${((change / current) * 100).toFixed(1)}%)` : ""}
            </span>
          )}
          {tooLow && <span className="w-full text-xs text-chip-pink-fg">Salary can't go below {pkr(MIN_BASE_SALARY)}.</span>}
        </div>
      )}
      {target && current == null && (
        <p className="text-xs text-chip-pink-fg">This employee has no base salary yet — set it on their profile first.</p>
      )}
      <p className="text-xs text-muted-2">
        Draft payslips from the effective month on are updated right away. Submitted or paid payslips stay as they are — use Details → Add adjustment on those if needed.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={!canSubmit}
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : isUp ? "Apply increment" : "Apply decrement"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-full border border-border-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2">
            Close
          </button>
        )}
      </div>
      {save.isError && <p className="text-xs text-chip-pink-fg">{save.error?.response?.data?.error || "Could not save the change"}</p>}
      {save.isSuccess && (
        <p className="text-xs text-chip-green-fg">
          Saved — new salary {pkr(save.data.revision.newSalary)}.
          {save.data.payslipsUpdated > 0 && ` ${save.data.payslipsUpdated} draft payslip${save.data.payslipsUpdated === 1 ? "" : "s"} updated.`}
          {save.data.payslipsLocked > 0 && ` ${save.data.payslipsLocked} submitted/paid payslip${save.data.payslipsLocked === 1 ? " was" : "s were"} left unchanged.`}
        </p>
      )}
    </div>
  )
}

// History list. With employeeId: that employee only; without: the org.
export function SalaryHistory({ employeeId, showEmployee = false, limit = 50, emptyText = "No salary changes yet." }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["salary-revisions", employeeId || "org", limit],
    queryFn: () => api.get("/payroll/salary-revisions", { params: { employeeId, limit } }).then((r) => r.data),
  })

  if (isLoading) return <p className="text-xs text-muted-2">Loading history…</p>
  if (isError) return <p className="text-xs text-chip-pink-fg">Couldn't load the salary history.</p>
  if (!data?.length) return <p className="text-xs text-muted-2">{emptyText}</p>

  return (
    <ul className="space-y-2">
      {data.map((r) => {
        const up = r.changeAmount > 0
        const Icon = r.source === "PROFILE_EDIT" ? Pencil : up ? TrendingUp : TrendingDown
        const tone = r.type === "SET" ? "text-muted" : up ? "text-chip-green-fg" : "text-chip-pink-fg"
        const typeLabel = r.type === "SET" ? "Salary set" : up ? "Increment" : "Decrement"
        return (
          <li key={r.id} className="rounded-2xl border border-border bg-surface px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {showEmployee && r.employee && (
                <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Avatar name={r.employee.name} src={r.employee.photoUrl} size="sm" /> {r.employee.name}
                </span>
              )}
              <span className={`flex items-center gap-1 text-xs font-semibold ${tone}`}>
                <Icon size={12} /> {typeLabel}
                {r.type !== "SET" && <span className="font-mono">{up ? "+" : "−"}{pkr(Math.abs(r.changeAmount))}{r.changePercent != null ? ` (${r.changePercent}%)` : ""}</span>}
              </span>
              <span className="ml-auto text-[11px] text-muted-2">
                {new Date(r.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>
            <div className="mt-1 font-mono text-xs text-muted">
              {r.previousSalary != null ? pkr(r.previousSalary) : "—"} → <span className="text-ink">{pkr(r.newSalary)}</span>
              <span className="font-sans text-muted-2"> · from {MONTHS[r.effectiveMonth - 1]} {r.effectiveYear}</span>
            </div>
            <div className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">
              {r.reason}
              <span className="text-muted-2">
                {r.createdBy ? ` — by ${r.createdBy.name}` : ""}
                {r.payslipsUpdated > 0 ? ` · ${r.payslipsUpdated} draft payslip${r.payslipsUpdated === 1 ? "" : "s"} updated` : ""}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function SalaryHistoryTitle({ children }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
      <History size={12} /> {children}
    </p>
  )
}
