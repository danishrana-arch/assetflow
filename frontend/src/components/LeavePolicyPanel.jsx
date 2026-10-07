import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarCheck, ChevronDown, ChevronUp } from "lucide-react"
import api from "../api/client"
import { TextField } from "./ui/Field"
import { Link } from "react-router-dom"

// Pro-rata leave policy (Organization.annualLeaveEntitlement / sick / casual
// — see backend utils/leave-policy.js). Shown on the Leave Requests page:
// ADMIN/CEO edit it (PATCH /organization is ADMIN/CEO-only), everyone else
// with the page sees it read-only.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const r2 = (n) => Math.round(n * 100) / 100

function Stat({ label, value, note, tone = "text-ink" }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-2 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold ${tone}`}>{value}</p>
      {note && <p className="text-[11px] text-muted-2">{note}</p>}
    </div>
  )
}

export default function LeavePolicyPanel({ canEdit }) {
  const queryClient = useQueryClient()
  const { data: organization } = useQuery({
    queryKey: ["organization"],
    queryFn: () => api.get("/organization").then((r) => r.data),
  })
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ total: 30, sick: 8, casual: 6 })

  useEffect(() => {
    if (organization && !editing) {
      setForm({
        total: organization.annualLeaveEntitlement ?? 30,
        sick: organization.sickLeaveAllowance ?? 8,
        casual: organization.casualLeaveAllowance ?? 6,
      })
    }
  }, [organization, editing])

  const save = useMutation({
    mutationFn: () =>
      api.patch("/organization", {
        annualLeaveEntitlement: Number(form.total),
        sickLeaveAllowance: Number(form.sick),
        casualLeaveAllowance: Number(form.casual),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization"] })
      queryClient.invalidateQueries({ queryKey: ["leave-balance"] })
      setEditing(false)
    },
  })

  const total = Number(form.total) || 0
  const sick = Number(form.sick) || 0
  const casual = Number(form.casual) || 0
  const annual = total - sick - casual
  const monthly = r2(total / 12)
  const invalid = annual < 0 || total < 0 || total > 365

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <section className="card mb-5 min-w-0 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-left">
          <span className="flex h-8 w-8 items-center justify-center text-ink">
            <CalendarCheck size={16} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-ink">Leave Policy</span>
            <span className="block text-xs text-muted">
              Pro-rata · {total} paid days a year · {monthly} earned per month
            </span>
          </span>
          {open ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
        </button>
        {open && canEdit && !editing && (
          <button
            type="button"
            onClick={() => { save.reset(); setEditing(true) }}
            className="rounded-full border border-border-strong bg-surface px-4 py-2 text-xs font-semibold text-ink hover:bg-surface-2"
          >
            Edit policy
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          {editing ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <TextField label="Total paid days / year" type="number" min={0} max={365} value={form.total} onChange={set("total")} />
              <TextField label="Sick days / year" type="number" min={0} max={365} value={form.sick} onChange={set("sick")} />
              <TextField label="Casual days / year" type="number" min={0} max={365} value={form.casual} onChange={set("casual")} />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total / year" value={`${total} days`} note={`${monthly} days earned each month`} />
            <Stat label="Annual" value={invalid ? "—" : `${annual} days`} note="The rest of the total" tone="text-chip-green-fg" />
            <Stat label="Casual" value={`${casual} days`} note="Per year" />
            <Stat label="Sick" value={`${sick} days`} note="Per year" />
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Earned by the end of each month (full year)</p>
            <div className="grid grid-cols-6 gap-1 sm:grid-cols-12">
              {MONTHS.map((m, i) => (
                <div key={m} className="rounded-lg bg-surface-2 px-1 py-1.5 text-center">
                  <div className="text-[10px] font-semibold text-muted">{m}</div>
                  <div className="font-mono text-xs text-ink">{r2(((i + 1) * total) / 12)}</div>
                </div>
              ))}
            </div>
          </div>

          <ul className="grid gap-x-6 gap-y-1.5 text-xs text-muted sm:grid-cols-2">
            <li>• Leave is earned month by month: {total} ÷ 12 = <span className="font-semibold text-ink">{monthly} days</span> per month, adding up through the year.</li>
            <li>• Leave starts from the month an employee becomes <span className="font-semibold text-ink">Permanent</span> — e.g. Permanent in August: {r2(total / 12)} days in August, growing each month to <span className="font-semibold text-ink">{r2((5 * total) / 12)} days</span> by December. Nothing is earned on probation.</li>
            <li>• Annual, casual and sick leave share this one total; each type also has its own yearly limit (pro-rated the same way).</li>
            <li>• An employee can only use what they'll have earned by the month of the leave — pending requests count too.</li>
            <li>• Unpaid leave doesn't use the balance; it's deducted from that month's payslip.</li>
            <li>• Only Permanent employees can apply. Balances reset every January (no carry forward).</li>
          </ul>

          <p className="rounded-2xl bg-surface-2 px-4 py-3 text-xs text-muted">
            Late-arrival rules (e.g. 3 late arrivals = half day, taken from leave), fines and the half-day policy are all set in one place:{" "}
            <Link to="/attendance" className="font-semibold text-accent hover:underline">Attendance → Policy &amp; fines</Link>.
          </p>

          {editing && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending || invalid}
                className="pill-accent px-5 py-2.5 text-sm disabled:opacity-60"
              >
                {save.isPending ? "Saving…" : "Save policy"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-full border border-border-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2"
              >
                Cancel
              </button>
              {annual < 0 && <p className="text-xs text-chip-pink-fg">Sick + casual can't be more than the total.</p>}
              {save.isError && <p className="text-xs text-chip-pink-fg">{save.error?.response?.data?.error || "Could not save — please try again"}</p>}
            </div>
          )}
          {!editing && save.isSuccess && <p className="text-xs text-chip-green-fg">Policy saved.</p>}
          {!canEdit && <p className="text-[11px] text-muted-2">Only an Admin or CEO can change the leave policy.</p>}
        </div>
      )}
    </section>
  )
}
