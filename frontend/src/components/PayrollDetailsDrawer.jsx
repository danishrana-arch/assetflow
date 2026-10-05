import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { X, History, Undo2, ShieldAlert, Plus, CalendarClock } from "lucide-react"
import api from "../api/client"
import StatusPill from "./ui/StatusPill"
import { formatTime, formatDateTime } from "../utils/time"

// Payroll → employee → Payroll details: the full payslip breakdown, the
// attendance days behind each deduction, and the adjustment history, with a
// controlled "Add adjustment" form. Adjustments never touch attendance —
// removing a late fine here credits the payslip; the day stays Late.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const STATUS_TONE = { DRAFT: "slate", PENDING_APPROVAL: "yellow", PAID: "green" }
const STATUS_LABEL = { DRAFT: "Generated (draft)", PENDING_APPROVAL: "Submitted for approval", PAID: "Finalized (paid)" }

function money(n) {
  return `PKR ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function signed(n) {
  const v = Number(n || 0)
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${money(Math.abs(v))}`
}

function minutes(m) {
  if (!m) return null
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}

const DAY_LABEL = { HALF_DAY: "Half day", EARLY_GOING: "Early going" }

function AdjustmentForm({ data, onDone }) {
  const queryClient = useQueryClient()
  const record = data.record
  const [type, setType] = useState("REMOVE_FINE")
  const [line, setLine] = useState("")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [confirmFinalized, setConfirmFinalized] = useState(false)
  const def = data.types.find((t) => t.key === type)
  const lineOptions = def?.lines ? data.lines.filter((l) => def.lines.includes(l.line) && l.effective > 0) : []
  const selected = data.lines.find((l) => l.line === line)
  const needsAmount = !def?.removesWholeLine
  const effect = def?.removesWholeLine
    ? selected?.effective || 0
    : (Number(amount) || 0) * (def?.sign === 0 ? 1 : def?.sign || 1)

  const save = useMutation({
    mutationFn: () =>
      api.post(`/payroll/${record.id}/adjustments`, {
        type,
        line: def?.lines ? line : undefined,
        amount: needsAmount ? Number(amount) : undefined,
        reason,
        confirmFinalized: data.permission.requiresOverride ? confirmFinalized : undefined,
      }).then((r) => r.data),
    onSuccess: () => {
      setAmount(""); setReason(""); setConfirmFinalized(false)
      queryClient.invalidateQueries({ queryKey: ["payroll-details", record.id] })
      queryClient.invalidateQueries({ queryKey: ["payroll"] })
      onDone?.()
    },
  })

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-3 rounded-2xl border border-border bg-canvas p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Plus size={14} /> Add adjustment</p>
      {data.permission.requiresOverride && (
        <div className="rounded-xl bg-chip-pink-bg px-3 py-2 text-xs text-chip-pink-fg">
          <p className="flex items-center gap-1.5 font-semibold"><ShieldAlert size={13} /> This payslip is finalized (paid)</p>
          <p className="mt-0.5">A change here is recorded as a finalized-payslip override and the employee is notified. Any money difference has to be settled separately.</p>
          <label className="mt-1.5 flex items-center gap-2 font-semibold">
            <input type="checkbox" checked={confirmFinalized} onChange={(e) => setConfirmFinalized(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            I understand — override the finalized payslip
          </label>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-muted">
          Type
          <select value={type} onChange={(e) => { setType(e.target.value); setLine(""); save.reset() }} className="field mt-1 py-2 text-sm">
            {data.types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        {def?.lines ? (
          <label className="text-xs font-semibold text-muted">
            Payslip line
            <select value={line} onChange={(e) => setLine(e.target.value)} required className="field mt-1 py-2 text-sm">
              <option value="">{lineOptions.length ? "Choose a line" : "Nothing to reduce"}</option>
              {lineOptions.map((l) => <option key={l.line} value={l.line}>{l.label} · {money(l.effective)}</option>)}
            </select>
          </label>
        ) : (
          <label className="text-xs font-semibold text-muted">
            Amount (PKR){def?.sign === 0 ? " — negative lowers pay" : ""}
            <input type="number" step="any" min={def?.sign === 0 ? undefined : "0.01"} value={amount} onChange={(e) => setAmount(e.target.value)} required className="field mt-1 py-2 text-sm" />
          </label>
        )}
        {def?.lines && needsAmount && (
          <label className="text-xs font-semibold text-muted">
            Amount to credit back (PKR)
            <input type="number" step="any" min="0.01" max={selected?.effective || undefined} value={amount} onChange={(e) => setAmount(e.target.value)} required className="field mt-1 py-2 text-sm" />
          </label>
        )}
      </div>
      <label className="block text-xs font-semibold text-muted">
        Reason (required — stays in the history)
        <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} required placeholder="e.g. Approved by management — site vehicle broke down" className="field mt-1 py-2 text-sm" />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted">
          Net pay {money(record.netPay)} → <span className="font-semibold text-ink">{money(Math.max(0, Number(record.netPay) + effect))}</span>
          {effect !== 0 && <span className={effect > 0 ? "text-chip-green-fg" : "text-chip-pink-fg"}> ({signed(effect)})</span>}
        </span>
        <button
          type="submit"
          disabled={save.isPending || !reason.trim() || (def?.lines && !line) || (needsAmount && !Number(amount)) || (data.permission.requiresOverride && !confirmFinalized)}
          className="pill-accent px-4 py-2 text-xs disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Record adjustment"}
        </button>
      </div>
      {save.isError && <p className="text-xs text-danger">{save.error?.response?.data?.error || "Couldn't save the adjustment."}</p>}
    </form>
  )
}

export default function PayrollDetailsDrawer({ recordId, onClose }) {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["payroll-details", recordId],
    queryFn: () => api.get(`/payroll/${recordId}/details`).then((r) => r.data),
  })
  const reverse = useMutation({
    mutationFn: ({ id, reason, confirmFinalized }) => api.post(`/payroll/${recordId}/adjustments/${id}/reverse`, { reason, confirmFinalized }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-details", recordId] })
      queryClient.invalidateQueries({ queryKey: ["payroll"] })
    },
  })

  const record = data?.record
  const tz = data?.timezone
  const earnings = useMemo(() => record ? [
    ["Basic salary", record.baseSalary],
    ["Bonus", record.bonus],
    ["Performance bonus", record.performanceBonus],
    ["Office expenses", record.expenseReimbursement],
    ["Termination settlement", record.terminationSettlement],
  ].filter(([, v]) => Number(v) > 0 || v === record.baseSalary) : [], [record])

  function undo(a) {
    if (data.permission.requiresOverride && !window.confirm("This payslip is finalized (paid). Reversing records a finalized-payslip override. Continue?")) return
    const reason = window.prompt(`Why are you reversing "${a.typeLabel}${a.lineLabel ? ` — ${a.lineLabel}` : ""}" (${signed(a.amount)})?`, "")
    if (!reason || !reason.trim()) return
    reverse.mutate({ id: a.id, reason, confirmFinalized: data.permission.requiresOverride ? true : undefined })
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-ink">{record?.employee?.name || "Payroll details"}</p>
            {record && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                {MONTHS[record.month - 1]} {record.year}
                <StatusPill tone={STATUS_TONE[record.status]}>{STATUS_LABEL[record.status] || record.status}</StatusPill>
                {data.adjusted && <StatusPill tone="purple">Adjusted</StatusPill>}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-muted hover:bg-surface-2" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {isLoading && <p className="text-sm text-muted">Loading payslip…</p>}
          {isError && <p className="text-sm text-danger">{error?.response?.data?.error || "Couldn't load this payslip."}</p>}

          {record && (
            <>
              {/* Breakdown */}
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Breakdown</p>
                <div className="overflow-hidden rounded-2xl border border-border text-sm">
                  {earnings.map(([label, v]) => (
                    <div key={label} className="flex justify-between border-b border-border px-4 py-2"><span className="text-muted">{label}</span><span className="font-mono text-chip-green-fg">+{money(v)}</span></div>
                  ))}
                  {data.lines.map((l) => (
                    <div key={l.line} className="flex justify-between gap-3 border-b border-border px-4 py-2">
                      <span className="text-muted">{l.label}</span>
                      <span className="text-right font-mono">
                        <span className="text-chip-pink-fg">−{money(l.original)}</span>
                        {l.credited !== 0 && <span className="block text-[11px] text-chip-green-fg">adjusted {signed(l.credited)} → {money(l.effective)}</span>}
                        {l.overCredited && <span className="block text-[10px] text-chip-yellow-fg">More was credited than this line now holds — review</span>}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between border-b border-border px-4 py-2">
                    <span className="text-muted">Manual adjustments</span>
                    <span className={`font-mono ${Number(record.adjustmentTotal) >= 0 ? "text-chip-green-fg" : "text-chip-pink-fg"}`}>{Number(record.adjustmentTotal) ? signed(record.adjustmentTotal) : "—"}</span>
                  </div>
                  <div className="flex justify-between bg-surface-2 px-4 py-2.5 font-semibold"><span className="text-ink">Net salary</span><span className="font-mono text-ink">{money(record.netPay)}</span></div>
                </div>
              </section>

              {/* Attendance deductions */}
              <section>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><CalendarClock size={13} /> Attendance deductions</p>
                {data.attendanceDays.length === 0 ? (
                  <p className="text-xs text-muted-2">No late, absent, half or short days this month.</p>
                ) : (
                  <div className="divide-y divide-border rounded-2xl border border-border">
                    {data.attendanceDays.map((d) => (
                      <div key={d.date} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-xs">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">
                            {new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${d.date}T00:00:00Z`))}
                            <span className="ml-2 font-normal text-muted">{DAY_LABEL[d.dayType] && ["PRESENT", "LATE"].includes(d.status) ? DAY_LABEL[d.dayType] : d.status === "LATE" ? "Late" : d.status === "ABSENT" ? "Absent" : d.status}</span>
                          </p>
                          {d.reason && <p className="mt-0.5 text-muted">{d.reason}</p>}
                          {(d.checkInAt || d.scheduledStartAt) && (
                            <p className="mt-0.5 text-muted-2">
                              {d.scheduledStartAt && `Scheduled ${formatTime(d.scheduledStartAt, { timeZone: tz })}`}
                              {d.checkInAt && ` · in ${formatTime(d.checkInAt, { timeZone: tz })}`}
                              {d.checkOutAt && ` · out ${formatTime(d.checkOutAt, { timeZone: tz })}`}
                              {minutes(d.lateMinutes) && ` · late ${minutes(d.lateMinutes)}`}
                            </p>
                          )}
                        </div>
                        <span className={`font-mono font-semibold ${d.waived ? "text-muted-2 line-through" : "text-chip-pink-fg"}`}>{d.amount ? `−${money(d.amount)}` : "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-1.5 text-[10px] text-muted-2">To remove or reduce one of these, add a "Remove fine" / "Reduce fine" adjustment below — the attendance record itself is not changed.</p>
              </section>

              {/* Adjust */}
              {data.permission.canAdjust ? (
                <AdjustmentForm data={data} />
              ) : (
                <p className="rounded-2xl bg-surface-2 px-4 py-3 text-xs text-muted">
                  {record.status === "PAID"
                    ? "This payslip is finalized (paid). Only the CEO can record a change, through the finalized-payslip override."
                    : record.status === "PENDING_APPROVAL"
                      ? "Submitted for approval — only an Admin or the CEO can adjust it now."
                      : "You can view this payslip but not adjust it."}
                </p>
              )}

              {/* History */}
              <section>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><History size={13} /> Adjustment history</p>
                {reverse.isError && <p className="mb-2 text-xs text-danger">{reverse.error?.response?.data?.error || "Couldn't reverse that adjustment."}</p>}
                {data.adjustments.length === 0 ? (
                  <p className="text-xs text-muted-2">No manual changes since this payslip was generated.</p>
                ) : (
                  <div className="space-y-2">
                    {[...data.adjustments].reverse().map((a) => (
                      <div key={a.id} className="rounded-2xl border border-border px-4 py-3 text-xs">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-ink">
                              {a.typeLabel}{a.lineLabel ? ` · ${a.lineLabel}` : ""}
                              {a.finalizedOverride && <span className="ml-1.5 rounded-full bg-chip-pink-bg px-1.5 py-0.5 text-[9px] font-semibold uppercase text-chip-pink-fg">Finalized override</span>}
                              {a.reversedById && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted">Reversed</span>}
                            </p>
                            <p className="mt-0.5 text-muted">“{a.reason}”</p>
                          </div>
                          <span className={`font-mono font-semibold ${a.amount >= 0 ? "text-chip-green-fg" : "text-chip-pink-fg"}`}>{signed(a.amount)}</span>
                        </div>
                        <p className="mt-1 text-muted-2">
                          {a.originalValue != null && a.newValue != null && <>{money(a.originalValue)} → {money(a.newValue)} · </>}
                          Net {money(a.previousNetPay)} → {money(a.newNetPay)} · {a.createdByName || "—"}{a.createdByRole ? ` (${a.createdByRole.replace("_", " ").toLowerCase()})` : ""} · {formatDateTime(a.createdAt, { timeZone: tz })}
                        </p>
                        {data.permission.canAdjust && a.type !== "FIELD_EDIT" && a.type !== "REVERSAL" && !a.reversedById && (
                          <button type="button" onClick={() => undo(a)} disabled={reverse.isPending} className="mt-1.5 inline-flex items-center gap-1 font-semibold text-accent hover:underline disabled:opacity-50">
                            <Undo2 size={11} /> Reverse
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
