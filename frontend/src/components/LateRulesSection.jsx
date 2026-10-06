import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Clock, Pencil, Plus, Trash2 } from "lucide-react"
import api from "../api/client"
import { TextField, SelectField } from "./ui/Field"

// Company late-arrival rules (backend utils/late-rules.js, /api/late-rules):
// e.g. "every 3 late arrivals in a month = half day". Full CRUD for
// ADMIN / CEO / HR; everyone else sees the list read-only.

const EMPTY = { name: "", lateCount: 3, result: "HALF_DAY", deductFrom: "LEAVE", replaceLateFine: true, active: true }
const RESULT_LABEL = { HALF_DAY: "Half day", FULL_DAY: "Full day" }
const FROM_LABEL = { LEAVE: "Leave balance (salary if no leave left)", SALARY: "Salary" }

function autoName(f) {
  return `${f.lateCount} late arrival${Number(f.lateCount) === 1 ? "" : "s"} = ${f.result === "FULL_DAY" ? "full day" : "half day"}`
}

function RuleForm({ initial, onSave, onCancel, saving, error }) {
  const [form, setForm] = useState(initial)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }))
  const name = form.name.trim() || autoName(form)
  const valid = Number.isInteger(Number(form.lateCount)) && Number(form.lateCount) >= 1 && Number(form.lateCount) <= 31

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField label="Rule name" maxLength={80} placeholder={autoName(form)} value={form.name} onChange={set("name")} />
        <TextField label="Every … late arrivals / month" type="number" min={1} max={31} value={form.lateCount} onChange={set("lateCount")} />
        <SelectField label="Counts as" value={form.result} onChange={set("result")}>
          <option value="HALF_DAY">Half day</option>
          <option value="FULL_DAY">Full day</option>
        </SelectField>
        <SelectField label="Deduct from" value={form.deductFrom} onChange={set("deductFrom")}>
          <option value="LEAVE">Leave balance (salary if no leave left)</option>
          <option value="SALARY">Salary</option>
        </SelectField>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-ink">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.replaceLateFine} onChange={set("replaceLateFine")} className="h-4 w-4 rounded border-border-strong" />
          Don't also charge the per-late fine for these late arrivals
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.active} onChange={set("active")} className="h-4 w-4 rounded border-border-strong" />
          Rule is on
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onSave({ ...form, name, lateCount: Number(form.lateCount) })}
          disabled={saving || !valid}
          className="pill-accent px-5 py-2 text-sm disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save rule"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-full border border-border-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2">
          Cancel
        </button>
        {error && <p className="text-xs text-chip-pink-fg">{error}</p>}
      </div>
    </div>
  )
}

export default function LateRulesSection({ canManage, plain = false }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(null) // "new" | rule id
  const [message, setMessage] = useState("")

  const { data: rules, isLoading, isError } = useQuery({
    queryKey: ["late-rules"],
    queryFn: () => api.get("/late-rules").then((r) => r.data),
  })

  const done = (text) => (data) => {
    queryClient.invalidateQueries({ queryKey: ["late-rules"] })
    queryClient.invalidateQueries({ queryKey: ["leave-balance"] })
    queryClient.invalidateQueries({ queryKey: ["payroll"] })
    setEditing(null)
    const n = data?.draftPayslipsRefreshed
    setMessage(`${text}${n ? ` · ${n} draft payslip${n === 1 ? "" : "s"} updated` : ""}`)
  }
  const create = useMutation({ mutationFn: (body) => api.post("/late-rules", body).then((r) => r.data), onSuccess: done("Rule added") })
  const update = useMutation({ mutationFn: ({ id, ...body }) => api.patch(`/late-rules/${id}`, body).then((r) => r.data), onSuccess: done("Rule saved") })
  const remove = useMutation({ mutationFn: (id) => api.delete(`/late-rules/${id}`).then((r) => r.data), onSuccess: done("Rule deleted") })
  const errorOf = (m) => m.error?.response?.data?.error || (m.isError ? "Could not save — please try again" : "")

  return (
    <div className={plain ? "" : "border-t border-border pt-4"}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          {!plain && <p className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Clock size={16} /> Late-arrival rules</p>}
          <p className="text-xs text-muted">
            Counted per employee per month. Bigger rules apply first and use up their late arrivals (e.g. with 6 = full day and 3 = half day, 7 lates = one full day).
          </p>
        </div>
        {canManage && editing !== "new" && (
          <button
            type="button"
            onClick={() => { create.reset(); setMessage(""); setEditing("new") }}
            className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-4 py-2 text-xs font-semibold text-ink hover:bg-surface-2"
          >
            <Plus size={14} /> Add rule
          </button>
        )}
      </div>

      {editing === "new" && (
        <div className="mb-3">
          <RuleForm initial={EMPTY} onSave={(body) => create.mutate(body)} onCancel={() => setEditing(null)} saving={create.isPending} error={errorOf(create)} />
        </div>
      )}

      {isLoading && <p className="text-xs text-muted-2">Loading rules…</p>}
      {isError && <p className="text-xs text-chip-pink-fg">Couldn't load the late-arrival rules.</p>}
      {rules && rules.length === 0 && editing !== "new" && (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-xs text-muted">No late-arrival rules — late arrivals are only charged the per-late fine.</p>
      )}

      <ul className="space-y-2">
        {(rules || []).map((rule) =>
          editing === rule.id ? (
            <li key={rule.id}>
              <RuleForm
                initial={{ name: rule.name, lateCount: rule.lateCount, result: rule.result, deductFrom: rule.deductFrom, replaceLateFine: rule.replaceLateFine, active: rule.active }}
                onSave={(body) => update.mutate({ id: rule.id, ...body })}
                onCancel={() => setEditing(null)}
                saving={update.isPending}
                error={errorOf(update)}
              />
            </li>
          ) : (
            <li key={rule.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3 ${rule.active ? "" : "opacity-60"}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  {rule.name}
                  {!rule.active && <span className="ml-2 rounded-full border border-border-strong px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">Off</span>}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Every <b className="text-ink">{rule.lateCount}</b> late arrival{rule.lateCount === 1 ? "" : "s"} in a month = <b className="text-ink">{RESULT_LABEL[rule.result]}</b> · {FROM_LABEL[rule.deductFrom]}
                  {rule.replaceLateFine ? " · replaces the per-late fine" : " · per-late fine still charged"}
                </p>
              </div>
              {canManage && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => update.mutate({ id: rule.id, active: !rule.active })}
                    disabled={update.isPending}
                    className="rounded-full border border-border-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2 disabled:opacity-60"
                  >
                    {rule.active ? "Turn off" : "Turn on"}
                  </button>
                  <button
                    type="button"
                    aria-label={`Edit ${rule.name}`}
                    onClick={() => { update.reset(); setMessage(""); setEditing(rule.id) }}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-surface"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${rule.name}`}
                    onClick={() => { if (window.confirm(`Delete the rule "${rule.name}"? Draft payslips and leave balances will be recalculated without it.`)) remove.mutate(rule.id) }}
                    disabled={remove.isPending}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-danger hover:bg-chip-pink-bg disabled:opacity-60"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </li>
          )
        )}
      </ul>

      {message && <p className="mt-2 text-xs text-chip-green-fg">{message}.</p>}
      {(update.isError && editing === null) || remove.isError ? (
        <p className="mt-2 text-xs text-chip-pink-fg">{errorOf(remove) || errorOf(update)}</p>
      ) : null}
      {!canManage && <p className="mt-2 text-[11px] text-muted-2">Only an Admin, CEO or HR can change these rules.</p>}
    </div>
  )
}
