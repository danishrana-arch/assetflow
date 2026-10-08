import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Archive, ArchiveRestore, CreditCard, ExternalLink, Plus } from "lucide-react"
import Modal from "../../components/billing/Modal"
import { SelectField, TextField } from "../../components/ui/Field"
import SecretDialog from "../../components/control/SecretDialog"
import StatusPill from "../../components/ui/StatusPill"
import MetricCard from "../../components/ui/MetricCard"
import DataTable from "../../components/control/DataTable"
import Toolbar, { FilterSelect } from "../../components/control/Toolbar"
import OrganizationDrawer from "../../components/control/OrganizationDrawer"
import { platformApi } from "../../api/platform"
import { errorMessage, fmtDate, label, toneFor } from "../../components/control/shared"
import { SectionTitle } from "./ControlCenterLayout"

export default function Organizations() {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [plan, setPlan] = useState("")
  const [openId, setOpenId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [secret, setSecret] = useState(null)
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ["platform", "organizations"], queryFn: platformApi.organizations })

  const planNames = useMemo(() => [...new Set((data || []).map((o) => o.plan?.name).filter(Boolean))], [data])
  const rows = (data || []).filter(
    (o) =>
      (!status || o.status === status) &&
      (!plan || o.plan?.name === plan) &&
      `${o.name} ${o.slug} ${o.group.name}`.toLowerCase().includes(search.toLowerCase()),
  )

  const total = data?.length || 0
  const active = (data || []).filter((o) => o.status === "ACTIVE").length

  return (
    <>
      <SectionTitle
        title="Organizations"
        subtitle="Every company on the platform. Open one for people, features, billing, usage and activity."
        actions={<button type="button" onClick={() => setAdding(true)} className="pill-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"><Plus size={15} /> Add organization</button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total" value={total} />
        <MetricCard label="Active" value={active} tone="green" />
        <MetricCard label="Suspended" value={(data || []).filter((o) => o.status === "SUSPENDED").length} tone={(data || []).some((o) => o.status === "SUSPENDED") ? "red" : undefined} hint={`${(data || []).filter((o) => o.status === "ARCHIVED").length} archived`} />
        <MetricCard label="Near or over a limit" value={(data || []).filter((o) => o.usageState !== "ok").length} tone={(data || []).some((o) => o.usageState !== "ok") ? "amber" : "green"} />
      </div>

      <Toolbar search={search} onSearch={setSearch} placeholder="Search organizations…">
        <FilterSelect label="All statuses" value={status} onChange={setStatus} options={[{ value: "ACTIVE", label: "Active" }, { value: "SUSPENDED", label: "Suspended" }, { value: "ARCHIVED", label: "Archived" }]} />
        <FilterSelect label="All plans" value={plan} onChange={setPlan} options={planNames} />
      </Toolbar>
      {error && <p role="alert" className="mb-2 text-sm text-danger">{errorMessage(error)}</p>}

      <DataTable
        loading={isLoading}
        rows={rows}
        onRowClick={(o) => setOpenId(o.id)}
        columns={[
          { key: "name", header: "Organization", render: (o) => <div className="min-w-0"><p className="truncate font-medium">{o.name}</p><p className="truncate text-xs text-muted">{o.isGroupMain ? "Main company" : `Group: ${o.group.name}`}</p></div>, sortValue: (o) => o.name },
          { key: "status", header: "Status", render: (o) => <StatusPill tone={toneFor(o.status)}>{label(o.status)}</StatusPill> },
          { key: "plan", header: "Plan", render: (o) => o.plan?.name || "—", sortValue: (o) => o.plan?.name || "" },
          { key: "subscriptionStatus", header: "Subscription", hideBelow: "md", render: (o) => <StatusPill tone={toneFor(o.subscriptionStatus)}>{label(o.subscriptionStatus)}</StatusPill> },
          { key: "employees", header: "Employees", sortValue: (o) => o.employees.used, render: (o) => <span className="tabular-nums">{o.employees.used}{o.employees.limit != null ? ` / ${o.employees.limit}` : ""}</span> },
          { key: "features", header: "Features", hideBelow: "lg", sortValue: (o) => o.featuresEnabled, render: (o) => <span className="tabular-nums">{o.featuresEnabled} / {o.featuresTotal}</span> },
          { key: "usageState", header: "Usage", hideBelow: "md", render: (o) => <StatusPill tone={toneFor(o.usageState)}>{o.usageState === "ok" ? "Healthy" : o.usageState === "warn" ? "Near limit" : "At limit"}</StatusPill> },
          { key: "createdAt", header: "Created", hideBelow: "lg", render: (o) => fmtDate(o.createdAt), sortValue: (o) => o.createdAt },
        ]}
        actions={(o) => [
          { label: "Open", icon: ExternalLink, onClick: () => setOpenId(o.id) },
          { label: "Change plan", icon: CreditCard, onClick: () => setOpenId(o.id) },
          { label: o.status === "SUSPENDED" ? "Lift suspension…" : o.status === "ARCHIVED" ? "Restore…" : "Suspend / archive…", icon: o.status === "ARCHIVED" ? ArchiveRestore : Archive, danger: o.status === "ACTIVE", onClick: () => setOpenId(o.id) },
        ]}
      />

      {adding && (
        <AddOrganizationDialog
          onClose={() => setAdding(false)}
          onCreated={(r) => {
            setAdding(false)
            queryClient.invalidateQueries({ queryKey: ["platform"] })
            setSecret({ title: "Organization created", intro: `${r.organization.name} is ready. Its first admin is ${r.adminEmail}.`, value: r.temporaryPassword })
          }}
        />
      )}
      {secret && <SecretDialog title={secret.title} intro={secret.intro} label="Admin temporary password" secret={secret.value} onClose={() => setSecret(null)} />}
      {openId && <OrganizationDrawer orgId={openId} onClose={() => setOpenId(null)} />}
    </>
  )
}

function AddOrganizationDialog({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", adminName: "", adminEmail: "", planKey: "" })
  const [error, setError] = useState("")
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const { data: plans } = useQuery({ queryKey: ["platform", "plans"], queryFn: platformApi.plans })
  const create = useMutation({
    mutationFn: () => platformApi.createOrganization({ ...form, planKey: form.planKey || undefined }),
    onSuccess: onCreated,
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <Modal
      title="Add an organization"
      subtitle="Creates a new company with its first Admin, who gets a temporary password you'll see once."
      onClose={onClose}
      busy={create.isPending}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={create.isPending} className="pill-secondary px-5 py-2.5 text-sm">Cancel</button>
          <button type="submit" form="add-org-form" disabled={create.isPending} className="pill-accent px-5 py-2.5 text-sm">{create.isPending ? "Creating…" : "Create organization"}</button>
        </>
      }
    >
      <form id="add-org-form" onSubmit={(e) => { e.preventDefault(); setError(""); create.mutate() }} className="space-y-3 pb-2">
        <TextField label="Organization name" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} required />
        <TextField label="First admin's name" value={form.adminName} onChange={(e) => set({ adminName: e.target.value })} maxLength={120} required />
        <TextField label="First admin's email" type="email" value={form.adminEmail} onChange={(e) => set({ adminEmail: e.target.value })} required />
        <SelectField label="Plan" value={form.planKey} onChange={(e) => set({ planKey: e.target.value })}>
          <option value="">Free (default)</option>
          {(plans || []).filter((p) => p.key !== "free" && p.active).map((p) => <option key={p.id} value={p.key}>{p.name} — assigned without payment</option>)}
        </SelectField>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  )
}
