import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import StatusPill from "../../components/ui/StatusPill"
import MetricCard from "../../components/ui/MetricCard"
import DataTable from "../../components/control/DataTable"
import Toolbar, { FilterSelect } from "../../components/control/Toolbar"
import UsageMeter from "../../components/control/UsageMeter"
import OrganizationDrawer from "../../components/control/OrganizationDrawer"
import { platformApi } from "../../api/platform"
import { errorMessage, toneFor } from "../../components/control/shared"
import { SectionTitle } from "./ControlCenterLayout"

const STATE_TEXT = { ok: "Healthy", warn: "Near limit", over: "At limit" }

export default function Usage() {
  const [search, setSearch] = useState("")
  const [state, setState] = useState("")
  const [openId, setOpenId] = useState(null)
  const { data, isLoading, error } = useQuery({ queryKey: ["platform", "usage"], queryFn: platformApi.usage })

  const rows = (data || []).filter((r) => (!state || r.state === state) && `${r.organization} ${r.plan}`.toLowerCase().includes(search.toLowerCase()))
  const count = (s) => (data || []).filter((r) => r.state === s).length

  return (
    <>
      <SectionTitle title="Usage" subtitle="Current usage against each plan's limits. Organizations at 80% or more of a limit are flagged." />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <MetricCard label="Healthy" value={count("ok")} tone="green" />
        <MetricCard label="Near a limit" value={count("warn")} tone={count("warn") ? "amber" : "green"} />
        <MetricCard label="At or over a limit" value={count("over")} tone={count("over") ? "red" : "green"} />
      </div>
      <Toolbar search={search} onSearch={setSearch} placeholder="Search organization or plan…">
        <FilterSelect label="All states" value={state} onChange={setState} options={[{ value: "over", label: "At limit" }, { value: "warn", label: "Near limit" }, { value: "ok", label: "Healthy" }]} />
      </Toolbar>
      {error && <p role="alert" className="mb-2 text-sm text-danger">{errorMessage(error)}</p>}
      <DataTable
        loading={isLoading}
        rows={rows}
        rowKey={(r) => r.organizationId}
        onRowClick={(r) => setOpenId(r.organizationId)}
        columns={[
          { key: "organization", header: "Organization" },
          { key: "plan", header: "Plan" },
          { key: "state", header: "State", render: (r) => <StatusPill tone={toneFor(r.state)}>{STATE_TEXT[r.state]}</StatusPill>, sortValue: (r) => ({ over: 0, warn: 1, ok: 2 })[r.state] },
          {
            key: "metrics",
            header: "Usage",
            sortable: false,
            render: (r) => (
              <div className="grid min-w-[260px] gap-2 sm:grid-cols-2">
                {r.metrics.filter((m) => m.limit != null || m.key === "employees").map((m) => <UsageMeter key={m.key} metric={m} compact />)}
              </div>
            ),
          },
        ]}
      />
      <p className="mt-2 text-xs text-muted">Employee limits are enforced when someone is added. Site, project, organization and storage limits only warn.</p>
      {openId && <OrganizationDrawer orgId={openId} onClose={() => setOpenId(null)} />}
    </>
  )
}
