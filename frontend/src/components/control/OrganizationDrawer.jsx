import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Archive, ArchiveRestore, CreditCard, Pause, Pencil, Play, Trash2 } from "lucide-react"
import DetailDrawer from "../ui/DetailDrawer"
import ActionMenu from "../ui/ActionMenu"
import StatusPill from "../ui/StatusPill"
import Modal from "../billing/Modal"
import { FieldValue, SelectField, TextField } from "../ui/Field"
import { platformApi } from "../../api/platform"
import { formatMoney } from "../../utils/billing"
import ConfirmDialog from "./ConfirmDialog"
import DataTable from "./DataTable"
import FeatureToggle from "./FeatureToggle"
import PermissionMatrix from "./PermissionMatrix"
import UsageMeter from "./UsageMeter"
import { AuditEntryList } from "./ChangeDiff"
import { errorMessage, fmtDate, label, toneFor } from "./shared"

const Loading = () => <div className="h-24 animate-pulse rounded-2xl bg-surface-2" />
const Section = ({ title, children, action }) => (
  <section className="mb-5">
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {action}
    </div>
    {children}
  </section>
)

/* The organization workspace: one reusable drawer, eight tabs. Tabs load their
   own data only when opened (DetailDrawer renders just the active tab). */
export default function OrganizationDrawer({ orgId, onClose }) {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState(null) // "rename" | "status" | "plan" | "cancel"
  const [error, setError] = useState("")
  const key = ["platform", "organization", orgId]
  const { data: org } = useQuery({ queryKey: key, queryFn: () => platformApi.organization(orgId), enabled: !!orgId })
  const { data: plans } = useQuery({ queryKey: ["platform", "plans"], queryFn: platformApi.plans, enabled: dialog === "plan" })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["platform"] })
  const done = () => { setDialog(null); setError(""); refresh() }
  const fail = (err) => setError(errorMessage(err))

  const rename = useMutation({ mutationFn: (name) => platformApi.renameOrganization(orgId, name), onSuccess: done, onError: fail })
  const setStatus = useMutation({ mutationFn: ({ status, reason }) => platformApi.setOrganizationStatus(orgId, status, reason), onSuccess: done, onError: fail })
  const assign = useMutation({ mutationFn: (body) => platformApi.assignSubscription(orgId, body), onSuccess: done, onError: fail })
  const remove = useMutation({ mutationFn: (name) => platformApi.deleteOrganization(orgId, name), onSuccess: () => { setDialog(null); setError(""); refresh(); onClose() }, onError: fail })
  const suspend = useMutation({ mutationFn: (reason) => platformApi.suspendOrganization(orgId, reason), onSuccess: done, onError: fail })
  const unsuspend = useMutation({ mutationFn: () => platformApi.unsuspendOrganization(orgId), onSuccess: done, onError: fail })
  const cancel = useMutation({ mutationFn: (reason) => platformApi.cancelSubscription(orgId, reason), onSuccess: done, onError: fail })

  const archived = org?.status === "ARCHIVED"
  const suspended = org?.status === "SUSPENDED"
  const open = (name) => () => { setError(""); setDialog(name) }

  const tabs = org
    ? [
        { key: "overview", label: "Overview", content: <OverviewTab org={org} /> },
        { key: "people", label: "People", content: <PeopleTab orgId={orgId} /> },
        { key: "hierarchy", label: "Hierarchy", content: <HierarchyTab org={org} /> },
        { key: "features", label: "Features", content: <FeaturesTab orgId={orgId} /> },
        { key: "permissions", label: "Permissions", content: <PermissionsTab orgId={orgId} /> },
        { key: "billing", label: "Billing", content: <BillingTab org={org} onChangePlan={open("plan")} onCancel={open("cancel")} /> },
        { key: "usage", label: "Usage", content: <UsageTab org={org} /> },
        { key: "activity", label: "Activity", content: <ActivityTab orgId={orgId} /> },
      ]
    : []

  return (
    <>
      <DetailDrawer
        open={!!orgId}
        onClose={onClose}
        resetKey={orgId}
        title={org?.name || "Organization"}
        subtitle={org ? `${org.slug} · ${label(org.status)}` : undefined}
        breadcrumb={[{ label: "Organizations", onClick: onClose }, { label: org?.name || "…" }]}
        tabs={tabs}
        actions={
          org && (
            <ActionMenu
              items={[
                { label: "Rename", icon: Pencil, onClick: open("rename") },
                { label: "Change plan", icon: CreditCard, onClick: open("plan") },
                { label: "Suspend for non-payment…", icon: Pause, danger: true, show: !archived && !suspended, onClick: open("suspend") },
                { label: "Lift suspension…", icon: Play, show: suspended, onClick: open("unsuspend") },
                { label: archived ? "Restore organization" : "Archive organization", icon: archived ? ArchiveRestore : Archive, danger: !archived, show: !suspended, onClick: open("status") },
                { label: "Delete permanently…", icon: Trash2, danger: true, show: archived || suspended, onClick: open("delete") },
              ]}
            />
          )
        }
      >
        {!org && <Loading />}
      </DetailDrawer>

      {dialog === "rename" && <RenameDialog org={org} busy={rename.isPending} error={error} onSubmit={(name) => rename.mutate(name)} onClose={() => setDialog(null)} />}
      {dialog === "status" && (
        <ConfirmDialog
          title={archived ? `Restore ${org.name}?` : `Archive ${org.name}?`}
          message={archived ? "Its users can sign in again." : "Its users are signed out and the company disappears from company lists. Nothing is deleted — payroll, attendance and audit history are kept."}
          confirmLabel={archived ? "Restore" : "Archive"}
          danger={!archived}
          requireReason={!archived}
          busy={setStatus.isPending}
          error={error}
          onClose={() => setDialog(null)}
          onConfirm={(reason) => setStatus.mutate({ status: archived ? "ACTIVE" : "ARCHIVED", reason })}
        />
      )}
      {dialog === "suspend" && (
        <ConfirmDialog
          title={`Suspend ${org.name}?`}
          message="Everyone in this organization is signed out and can't sign back in; they're told it's an overdue payment. Nothing is deleted — you can lift the suspension any time."
          confirmLabel="Suspend organization"
          danger
          requireReason
          reasonLabel="Reason (e.g. invoice overdue)"
          busy={suspend.isPending}
          error={error}
          onClose={() => setDialog(null)}
          onConfirm={(reason) => suspend.mutate(reason)}
        />
      )}
      {dialog === "unsuspend" && (
        <ConfirmDialog
          title={`Lift the suspension on ${org.name}?`}
          message="Their people can sign in again straight away."
          confirmLabel="Lift suspension"
          busy={unsuspend.isPending}
          error={error}
          onClose={() => setDialog(null)}
          onConfirm={() => unsuspend.mutate()}
        />
      )}
      {dialog === "delete" && <DeleteOrgDialog org={org} busy={remove.isPending} error={error} onSubmit={(name) => remove.mutate(name)} onClose={() => setDialog(null)} />}
      {dialog === "cancel" && (
        <ConfirmDialog
          title="Cancel subscription?"
          message={`${org.name} moves to the Free plan. Features outside the Free plan stop working for them.`}
          confirmLabel="Cancel subscription"
          danger
          requireReason
          busy={cancel.isPending}
          error={error}
          onClose={() => setDialog(null)}
          onConfirm={(reason) => cancel.mutate(reason)}
        />
      )}
      {dialog === "plan" && <AssignPlanDialog org={org} plans={plans} busy={assign.isPending} error={error} onSubmit={(b) => assign.mutate(b)} onClose={() => setDialog(null)} />}
    </>
  )
}

function DeleteOrgDialog({ org, busy, error, onSubmit, onClose }) {
  const [typed, setTyped] = useState("")
  return (
    <Modal
      title={`Permanently delete ${org.name}?`}
      subtitle="This removes the organization, its users and its activity log for good. It can't be undone."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="pill-secondary px-5 py-2.5 text-sm">Cancel</button>
          <button type="button" disabled={busy || typed !== org.name} onClick={() => onSubmit(typed)} className="rounded-full bg-danger px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Deleting…" : "Delete permanently"}</button>
        </>
      }
    >
      <div className="pb-2">
        <TextField label={`Type "${org.name}" to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  )
}

function RenameDialog({ org, busy, error, onSubmit, onClose }) {
  const [name, setName] = useState(org.name)
  return (
    <Modal
      title="Rename organization"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="pill-secondary px-5 py-2.5 text-sm">Cancel</button>
          <button type="submit" form="rename-form" disabled={busy || !name.trim()} className="pill-accent px-5 py-2.5 text-sm">{busy ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <form id="rename-form" onSubmit={(e) => { e.preventDefault(); onSubmit(name) }} className="pb-2">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  )
}

function AssignPlanDialog({ org, plans, busy, error, onSubmit, onClose }) {
  const current = org.subscription.plan
  const [planKey, setPlanKey] = useState(current?.key || "")
  const [status, setStatus] = useState(org.subscription.status)
  const [reason, setReason] = useState("")
  const chosen = plans?.find((p) => p.key === planKey)
  return (
    <Modal
      title="Change plan"
      subtitle="An administrative assignment. No payment is collected — paid plans are charged through the payment provider, which isn't connected yet."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="pill-secondary px-5 py-2.5 text-sm">Cancel</button>
          <button type="submit" form="assign-form" disabled={busy || !planKey || reason.trim().length < 3} className="pill-accent px-5 py-2.5 text-sm">{busy ? "Saving…" : "Assign plan"}</button>
        </>
      }
    >
      <form id="assign-form" onSubmit={(e) => { e.preventDefault(); onSubmit({ planKey, status, reason }) }} className="space-y-3 pb-2">
        <SelectField label="Plan" value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
          {!plans && <option value="">Loading…</option>}
          {plans?.map((p) => (
            <option key={p.id} value={p.key}>{p.name} — {p.isCustom ? "Custom" : formatMoney(p.effectivePriceCents, p.currency)}{p.active ? "" : " (inactive)"}</option>
          ))}
        </SelectField>
        {chosen && <p className="text-xs text-muted">Employee limit: {chosen.employeeLimit ?? "no cap"} · {chosen.featureKeys.length} features included.</p>}
        <SelectField label="Subscription status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ACTIVE">Active</option>
          <option value="PAST_DUE">Past due</option>
          <option value="CANCELED">Canceled</option>
          <option value="SUSPENDED">Suspended (blocks sign-in)</option>
        </SelectField>
        <div>
          <label htmlFor="assign-reason" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Reason</label>
          <textarea id="assign-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="field resize-none" placeholder="Recorded in the audit log" />
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  )
}

// ── Tabs ─────────────────────────────────────────────────────────────────

function OverviewTab({ org }) {
  const employees = org.usage.find((m) => m.key === "employees")
  return (
    <>
      <Section title="Details">
        <div className="grid grid-cols-2 gap-4 rounded-2xl border border-border bg-surface p-4">
          <FieldValue label="Status" value={<StatusPill tone={toneFor(org.status)}>{label(org.status)}</StatusPill>} />
          <FieldValue label="Plan" value={org.subscription.plan?.name} />
          <FieldValue label="Subscription" value={<StatusPill tone={toneFor(org.subscription.status)}>{label(org.subscription.status)}</StatusPill>} />
          <FieldValue label="Employees" value={employees ? `${employees.used}${employees.limit != null ? ` / ${employees.limit}` : ""}` : null} />
          <FieldValue label="Created" value={fmtDate(org.createdAt)} />
          <FieldValue label="Time zone" value={org.timezone} />
          <FieldValue label="Slug" value={org.slug} />
          <FieldValue label="Company group" value={`${org.hierarchy.length} ${org.hierarchy.length === 1 ? "company" : "companies"}`} />
        </div>
      </Section>
      {org.archivedAt && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">Archived on {fmtDate(org.archivedAt)}.</p>}
    </>
  )
}

function PeopleTab({ orgId }) {
  const [search, setSearch] = useState("")
  const { data, isLoading } = useQuery({ queryKey: ["platform", "organization", orgId, "people"], queryFn: () => platformApi.organizationPeople(orgId) })
  const rows = (data || []).filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people…" aria-label="Search people" className="field mb-3 max-w-xs" />
      <DataTable
        loading={isLoading}
        rows={rows}
        columns={[
          { key: "name", header: "Name", render: (u) => <div className="min-w-0"><p className="truncate font-medium">{u.name}</p><p className="truncate text-xs text-muted">{u.email}</p></div>, sortValue: (u) => u.name },
          { key: "role", header: "Role", render: (u) => label(u.role) },
          { key: "status", header: "Status", render: (u) => <StatusPill tone={toneFor(u.status)}>{label(u.status)}</StatusPill> },
        ]}
      />
    </>
  )
}

function HierarchyTab({ org }) {
  return (
    <>
      <p className="mb-3 text-sm text-muted">
        Companies in a group are peers: a CEO reaches every company in the group, an Admin or IT Manager their own plus any a CEO granted, and everyone else only their own.
      </p>
      <DataTable
        rows={org.hierarchy}
        columns={[
          { key: "name", header: "Company", render: (o) => <span className={o.current ? "font-semibold" : ""}>{o.name}{o.current && <span className="ml-2 text-xs text-muted">(this one)</span>}</span> },
          { key: "role", header: "Role in group", sortable: false, render: (o) => (o.isGroupMain ? "Main company" : "Company") },
          { key: "employees", header: "Employees", sortValue: (o) => o.employees },
          { key: "status", header: "Status", render: (o) => <StatusPill tone={toneFor(o.status)}>{label(o.status)}</StatusPill> },
        ]}
      />
    </>
  )
}

function FeaturesTab({ orgId }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState("")
  const key = ["platform", "organization", orgId, "features"]
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => platformApi.organizationFeatures(orgId) })
  const set = useMutation({
    mutationFn: ({ featureKey, enabled }) => platformApi.setOrganizationFeature(orgId, featureKey, enabled),
    onSuccess: () => { setError(""); queryClient.invalidateQueries({ queryKey: ["platform"] }) },
    onError: (err) => setError(errorMessage(err)),
  })
  if (isLoading) return <Loading />
  return (
    <div className="space-y-2">
      <p className="mb-1 text-sm text-muted">Included by the plan unless overridden here. A user needs the feature <em>and</em> a role that permits it.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {data.map((f) => (
        <FeatureToggle
          key={f.key}
          label={f.label}
          description={f.description}
          checked={f.enabled}
          source={f.source}
          locked={f.source === "PLATFORM_OFF"}
          busy={set.isPending}
          onChange={(enabled) => set.mutate({ featureKey: f.key, enabled })}
          trailing={f.override && <button type="button" onClick={() => set.mutate({ featureKey: f.key, enabled: null })} className="mt-1 text-xs font-semibold text-accent hover:underline">Reset to plan default</button>}
        />
      ))}
    </div>
  )
}

function PermissionsTab({ orgId }) {
  const { data: roles } = useQuery({ queryKey: ["platform", "roles"], queryFn: platformApi.roles })
  const { data: feats } = useQuery({ queryKey: ["platform", "organization", orgId, "features"], queryFn: () => platformApi.organizationFeatures(orgId) })
  const { data: perms } = useQuery({ queryKey: ["platform", "organization", orgId, "permissions"], queryFn: () => platformApi.organizationPermissions(orgId) })
  if (!roles || !feats || !perms) return <Loading />
  const featureOfModule = Object.fromEntries(roles.modules.map((m) => [m.key, m.feature]))
  const entitled = Object.fromEntries(feats.map((f) => [f.key, f.enabled]))
  const roleHas = (role, featureKey) => {
    const mods = roles.roles.find((r) => r.role === role)?.modules || []
    if (mods.includes("*")) return true
    return mods.some((m) => featureOfModule[m] === featureKey)
  }
  const shown = roles.roles.filter((r) => r.role !== "PLATFORM_ADMIN")
  const crud = [{ key: "canCreate", label: "Create" }, { key: "canRead", label: "Read" }, { key: "canUpdate", label: "Update" }, { key: "canDelete", label: "Delete" }]
  return (
    <>
      <Section title="Effective access (role permission AND this organization's features)">
        <PermissionMatrix
          caption="Roles by feature"
          rows={shown.map((r) => ({ key: r.role, label: label(r.role), sub: perms.roleCounts[r.role] ? `${perms.roleCounts[r.role]} here` : undefined }))}
          columns={feats.map((f) => ({ key: f.key, label: f.label }))}
          allowed={(role, featureKey) => roleHas(role, featureKey) && entitled[featureKey]}
        />
        <p className="mt-2 text-xs text-muted">Role access is defined in code. To change who can do what inside this company, its Admin uses Settings → Attendance permission matrix.</p>
      </Section>
      <Section title="Attendance permissions set by this company">
        <AttendancePermissionsEditor orgId={orgId} rows={perms.attendance} />
      </Section>
    </>
  )
}

const ATT_ROLES = ["HR", "MANAGEMENT", "DEPARTMENT_HEAD", "IT_MANAGER", "SITE_ADMIN", "EMPLOYEE"]
const CRUD_FIELDS = [["canCreate", "Create"], ["canRead", "Read"], ["canUpdate", "Update"], ["canDelete", "Delete"]]

// Create / read / update / delete per role for this company's attendance.
// Admin and CEO always have full access, so they aren't listed.
function AttendancePermissionsEditor({ orgId, rows }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState(() => Object.fromEntries(ATT_ROLES.map((r) => [r, Object.fromEntries(CRUD_FIELDS.map(([f]) => [f, !!rows.find((x) => x.role === r)?.[f]]))])))
  const [msg, setMsg] = useState(null)
  const save = useMutation({
    mutationFn: () => platformApi.setAttendancePermissions(orgId, ATT_ROLES.map((role) => ({ role, ...state[role] }))),
    onSuccess: () => { setMsg({ ok: true, text: "Saved." }); queryClient.invalidateQueries({ queryKey: ["platform"] }) },
    onError: (err) => setMsg({ ok: false, text: errorMessage(err) }),
  })
  const toggle = (role, field) => { setMsg(null); setState((s) => ({ ...s, [role]: { ...s[role], [field]: !s[role][field] } })) }
  return (
    <div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-[11px] uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Role</th>
              {CRUD_FIELDS.map(([, l]) => <th key={l} className="px-3 py-2.5 text-center">{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {ATT_ROLES.map((role) => (
              <tr key={role} className="border-b border-border last:border-0">
                <th scope="row" className="px-4 py-2 text-left font-medium text-ink">{label(role)}</th>
                {CRUD_FIELDS.map(([f, l]) => (
                  <td key={f} className="px-3 py-2 text-center">
                    <input type="checkbox" checked={state[role][f]} onChange={() => toggle(role, f)} aria-label={`${label(role)} can ${l.toLowerCase()}`} className="h-4 w-4 accent-[var(--accent)]" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="pill-accent px-5 py-2 text-sm">{save.isPending ? "Saving…" : "Save permissions"}</button>
        {msg && <p role="status" className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
      </div>
    </div>
  )
}

function BillingTab({ org, onChangePlan, onCancel }) {
  const { data: invoices, isLoading } = useQuery({ queryKey: ["platform", "organization", org.id, "invoices"], queryFn: () => platformApi.organizationInvoices(org.id) })
  const sub = org.subscription
  const paid = sub.priceCents > 0
  return (
    <>
      <Section
        title="Subscription"
        action={
          <div className="flex gap-2">
            <button type="button" onClick={onChangePlan} className="pill-secondary px-3 py-1.5 text-xs">Change plan</button>
            {sub.plan?.key !== "free" && <button type="button" onClick={onCancel} className="rounded-full px-3 py-1.5 text-xs font-semibold text-danger hover:bg-surface-2">Cancel subscription</button>}
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-4 rounded-2xl border border-border bg-surface p-4">
          <FieldValue label="Plan" value={sub.plan?.name} />
          <FieldValue label="Status" value={<StatusPill tone={toneFor(sub.status)}>{label(sub.status)}</StatusPill>} />
          <FieldValue label="Monthly charge" value={paid ? `${formatMoney(sub.priceCents, sub.plan?.currency)}/month` : "No charge"} />
          <FieldValue label="Next billing date" value={paid ? fmtDate(sub.currentPeriodEnd) : null} />
          <FieldValue label="Payment provider" value={sub.providerLinked ? "Subscription linked" : "Not linked"} />
          <FieldValue label="Plan price" value={sub.plan ? (sub.plan.isCustom ? "Custom" : `${formatMoney(sub.plan.effectivePriceCents, sub.plan.currency)}/month`) : null} />
        </div>
      </Section>
      <Section title="Invoices">
        <DataTable
          loading={isLoading}
          rows={invoices || []}
          empty={<p className="py-4 text-center text-sm text-muted">No invoices yet. They appear here once the payment provider is connected and bills this company.</p>}
          columns={[
            { key: "number", header: "Invoice" },
            { key: "issuedAt", header: "Issued", render: (i) => fmtDate(i.issuedAt), sortValue: (i) => i.issuedAt },
            { key: "amountCents", header: "Amount", render: (i) => formatMoney(i.amountCents, i.currency), sortValue: (i) => i.amountCents },
            { key: "status", header: "Status", render: (i) => <StatusPill tone={toneFor(i.status)}>{label(i.status)}</StatusPill> },
          ]}
        />
      </Section>
    </>
  )
}

function UsageTab({ org }) {
  return (
    <div className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      {org.usage.map((m) => <UsageMeter key={m.key} metric={m} />)}
      <p className="text-xs text-muted">Only the employee limit is enforced when adding people. The other limits warn here and in Usage.</p>
    </div>
  )
}

function ActivityTab({ orgId }) {
  const { data, isLoading } = useQuery({ queryKey: ["platform", "organization", orgId, "activity"], queryFn: () => platformApi.organizationActivity(orgId) })
  return isLoading ? <Loading /> : <AuditEntryList entries={data} />
}
