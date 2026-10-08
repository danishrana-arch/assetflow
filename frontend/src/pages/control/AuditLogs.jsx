import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import DetailDrawer from "../../components/ui/DetailDrawer"
import { FieldValue } from "../../components/ui/Field"
import DataTable from "../../components/control/DataTable"
import Toolbar, { FilterSelect } from "../../components/control/Toolbar"
import { ChangeDiff } from "../../components/control/ChangeDiff"
import { platformApi } from "../../api/platform"
import { actionLabel, errorMessage, fmtDateTime } from "../../components/control/shared"
import { SectionTitle } from "./ControlCenterLayout"

// Every audit entry across the platform. "Platform actions" narrows to what
// was done from the Control Center plus plan/billing/permission changes.
export default function AuditLogs() {
  const [search, setSearch] = useState("")
  const [scope, setScope] = useState("platform")
  const [organizationId, setOrganizationId] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)

  const params = {
    page,
    pageSize: 30,
    scope: scope || undefined,
    search: search || undefined,
    organizationId: organizationId || undefined,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
  }
  const { data, isLoading, error } = useQuery({ queryKey: ["platform", "audit", params], queryFn: () => platformApi.audit(params) })
  const { data: orgs } = useQuery({ queryKey: ["platform", "organizations"], queryFn: platformApi.organizations })
  const reset = (setter) => (v) => { setter(v); setPage(1) }

  return (
    <>
      <SectionTitle title="Audit Logs" subtitle="Who did what, where and when — with the values before and after." />
      <Toolbar search={search} onSearch={reset(setSearch)} placeholder="Search action, note or person…">
        <FilterSelect label="Everything" value={scope === "platform" ? "platform" : ""} onChange={(v) => { setScope(v); setPage(1) }} options={[{ value: "platform", label: "Platform actions" }]} />
        <FilterSelect label="All organizations" value={organizationId} onChange={reset(setOrganizationId)} options={(orgs || []).map((o) => ({ value: o.id, label: o.name }))} />
        <label className="flex items-center gap-1.5 text-xs text-muted">From <input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} className="field !w-auto !py-1.5" /></label>
        <label className="flex items-center gap-1.5 text-xs text-muted">To <input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} className="field !w-auto !py-1.5" /></label>
      </Toolbar>
      {error && <p role="alert" className="mb-2 text-sm text-danger">{errorMessage(error)}</p>}
      <DataTable
        loading={isLoading}
        rows={data?.rows || []}
        page={page}
        pageSize={data?.pageSize || 30}
        total={data?.total ?? 0}
        onPageChange={setPage}
        onRowClick={setSelected}
        columns={[
          { key: "createdAt", header: "When", render: (e) => <span className="whitespace-nowrap">{fmtDateTime(e.createdAt)}</span> },
          { key: "actor", header: "Actor", render: (e) => e.actor?.name || "System" },
          { key: "organization", header: "Organization", hideBelow: "md", render: (e) => e.organization?.name },
          { key: "action", header: "Action", render: (e) => <span className="capitalize">{actionLabel(e.action)}</span> },
          { key: "note", header: "Summary", hideBelow: "lg", render: (e) => <span className="line-clamp-1 text-xs text-muted">{e.note}</span> },
        ]}
      />

      <DetailDrawer open={!!selected} onClose={() => setSelected(null)} resetKey={selected?.id} title={selected ? actionLabel(selected.action) : ""} subtitle={selected?.note} breadcrumb={[{ label: "Audit Logs", onClick: () => setSelected(null) }, { label: "Entry" }]}>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 rounded-2xl border border-border bg-surface p-4">
              <FieldValue label="Actor" value={selected.actor?.name || "System"} />
              <FieldValue label="Organization" value={selected.organization?.name} />
              <FieldValue label="When" value={fmtDateTime(selected.createdAt)} />
              <FieldValue label="Target" value={selected.targetType ? `${selected.targetType}${selected.targetId ? ` · ${selected.targetId}` : ""}` : null} />
            </div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Changes</h3>
            <ChangeDiff details={selected.details} />
          </div>
        )}
      </DetailDrawer>
    </>
  )
}
