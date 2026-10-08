import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import Modal from "./Modal"
import { SelectField, TextAreaField, TextField } from "../ui/Field"
import { billingApi, errorText } from "../../api/billing"

function Check({ label, hint, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-surface-2 p-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
      <span>
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  )
}

// Create or edit a plan. Pass `plan` to edit, nothing to create.
// `api` defaults to the company Billing API; the Control Center passes its own.
// `features` ([{key,label}]) switches on the limits + entitlement section.
export default function PlanEditorModal({ plan, onClose, onSaved, api = billingApi, features }) {
  const editing = !!plan
  const [form, setForm] = useState({
    key: plan?.key || "",
    name: plan?.name || "",
    description: plan?.description || "",
    price: plan ? String(plan.priceCents / 100) : "0",
    employeeLimit: plan?.employeeLimit != null ? String(plan.employeeLimit) : "",
    features: (plan?.features || []).join("\n"),
    recommended: plan?.recommended || false,
    active: plan?.active ?? true,
    isCustom: plan?.isCustom || false,
    siteLimit: plan?.siteLimit != null ? String(plan.siteLimit) : "",
    projectLimit: plan?.projectLimit != null ? String(plan.projectLimit) : "",
    organizationLimit: plan?.organizationLimit != null ? String(plan.organizationLimit) : "",
    storageLimitMb: plan?.storageLimitMb != null ? String(plan.storageLimitMb) : "",
    stripePriceId: plan?.stripePriceId || "",
    featureKeys: plan ? plan.featureKeys || [] : (features || []).map((f) => f.key),
  })
  const [error, setError] = useState("")
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const isFree = plan?.key === "free"

  const save = useMutation({
    mutationFn: () => {
      const dollars = Number(form.price)
      if (!form.isCustom && (!Number.isFinite(dollars) || dollars < 0)) throw new Error("Enter a valid monthly price")
      const body = {
        name: form.name,
        description: form.description,
        priceCents: form.isCustom ? 0 : Math.round(dollars * 100),
        employeeLimit: form.employeeLimit.trim() === "" ? null : Number(form.employeeLimit),
        features: form.features.split("\n").map((f) => f.trim()).filter(Boolean),
        recommended: form.recommended,
        active: form.active,
        isCustom: form.isCustom,
      }
      if (features) {
        const cap = (v) => (v.trim() === "" ? null : Number(v))
        Object.assign(body, {
          siteLimit: cap(form.siteLimit),
          projectLimit: cap(form.projectLimit),
          organizationLimit: cap(form.organizationLimit),
          storageLimitMb: cap(form.storageLimitMb),
          stripePriceId: form.stripePriceId,
          featureKeys: form.featureKeys,
        })
      }
      return editing ? api.updatePlan(plan.id, body) : api.createPlan({ ...body, key: form.key })
    },
    onSuccess: (saved) => onSaved(saved, editing),
    onError: (err) => setError(err.message && !err.response ? err.message : errorText(err)),
  })

  const submit = (e) => {
    e.preventDefault()
    setError("")
    save.mutate()
  }

  return (
    <Modal
      title={editing ? `Edit ${plan.name}` : "Add a plan"}
      subtitle={editing ? "A price change applies to new subscriptions; a limit change applies to everyone on the plan." : "New plans appear on the pricing page straight away."}
      onClose={onClose}
      busy={save.isPending}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={save.isPending} className="pill-secondary px-5 py-2.5 text-sm">Cancel</button>
          <button type="submit" form="plan-form" disabled={save.isPending} className="pill-accent px-5 py-2.5 text-sm">{save.isPending ? "Saving…" : editing ? "Save changes" : "Create plan"}</button>
        </>
      }
    >
      <form id="plan-form" onSubmit={submit} className="space-y-4 pb-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} required />
          <TextField
            label="Key"
            value={form.key}
            onChange={(e) => set({ key: e.target.value.toLowerCase() })}
            disabled={editing}
            placeholder="team-plus"
            hint={editing ? "The key can't change." : "Lowercase letters, numbers, dashes."}
            required={!editing}
          />
        </div>
        <TextAreaField label="Description" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={300} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Monthly price (USD)"
            type="number"
            min="0"
            step="0.01"
            value={form.isCustom ? "0" : form.price}
            onChange={(e) => set({ price: e.target.value })}
            disabled={form.isCustom || isFree}
            hint={isFree ? "The Free plan stays free." : form.isCustom ? "Custom plans are quoted by our team." : undefined}
          />
          <TextField
            label="Employee limit"
            type="number"
            min="1"
            step="1"
            value={form.employeeLimit}
            onChange={(e) => set({ employeeLimit: e.target.value })}
            placeholder="No cap"
            hint="Leave empty for no cap."
          />
        </div>
        {features && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Site limit" type="number" min="1" value={form.siteLimit} onChange={(e) => set({ siteLimit: e.target.value })} placeholder="No cap" hint="Warning only — not enforced yet." />
              <TextField label="Project limit" type="number" min="1" value={form.projectLimit} onChange={(e) => set({ projectLimit: e.target.value })} placeholder="No cap" hint="Warning only — not enforced yet." />
              <TextField label="Organization limit" type="number" min="1" value={form.organizationLimit} onChange={(e) => set({ organizationLimit: e.target.value })} placeholder="No cap" hint="Warning only — not enforced yet." />
              <TextField label="Storage limit (MB)" type="number" min="1" value={form.storageLimitMb} onChange={(e) => set({ storageLimitMb: e.target.value })} placeholder="No cap" hint="Employee documents. Warning only." />
            </div>
            <TextField label="Payment provider price ID" value={form.stripePriceId} onChange={(e) => set({ stripePriceId: e.target.value })} placeholder="price_…" hint="Identifier only — never a secret key. Billing interval: monthly." />
            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Included features</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {features.map((f) => (
                  <Check key={f.key} label={f.label} checked={form.featureKeys.includes(f.key)} onChange={(v) => set({ featureKeys: v ? [...form.featureKeys, f.key] : form.featureKeys.filter((k) => k !== f.key) })} />
                ))}
              </div>
            </fieldset>
          </>
        )}
        <TextAreaField label="Features (one per line)" rows={6} value={form.features} onChange={(e) => set({ features: e.target.value })} />
        <div className="grid gap-2">
          <Check label="Recommended" hint="Shows the badge. Only one plan can be recommended." checked={form.recommended} onChange={(v) => set({ recommended: v })} />
          <Check label="Active" hint="Inactive plans are hidden from everyone but plan managers." checked={form.active} onChange={(v) => set({ active: v })} />
          <Check label="Contact-sales plan" hint="Sold through “Contact Our Team”, never through checkout." checked={form.isCustom} onChange={(v) => set({ isCustom: v })} />
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  )
}
