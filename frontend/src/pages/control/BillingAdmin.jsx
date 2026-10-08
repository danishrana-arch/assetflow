import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import StatusPill from "../../components/ui/StatusPill"
import MetricCard from "../../components/ui/MetricCard"
import Tabs from "../../components/ui/Tabs"
import DataTable from "../../components/control/DataTable"
import Toolbar from "../../components/control/Toolbar"
import OrganizationDrawer from "../../components/control/OrganizationDrawer"
import { platformApi } from "../../api/platform"
import { formatMoney } from "../../utils/billing"
import { errorMessage, fmtDate, fmtDateTime, label, toneFor } from "../../components/control/shared"
import { SectionTitle } from "./ControlCenterLayout"

// Billing across all organizations: subscriptions, invoices and the sales
// inquiries from the Custom plan. Changing one organization's plan or
// cancelling it happens in that organization's drawer (Billing tab).
export default function BillingAdmin() {
  const [tab, setTab] = useState("subscriptions")
  const [openId, setOpenId] = useState(null)
  const { data: subs } = useQuery({ queryKey: ["platform", "subscriptions"], queryFn: platformApi.subscriptions })

  const rows = subs?.rows || []
  const paid = rows.filter((r) => r.priceCents > 0)
  const mrr = paid.reduce((sum, r) => sum + r.priceCents, 0)

  return (
    <>
      <SectionTitle title="Billing" subtitle="Subscriptions, invoices and sales inquiries across all organizations." />
      {subs && !subs.paymentsConfigured && (
        <p className="mb-4 rounded-xl bg-chip-yellow-bg px-4 py-3 text-sm text-chip-yellow-fg">
          Online payments aren't connected, so paid plans can't be purchased and no invoices exist yet. Plan changes made here are administrative assignments that collect no payment. Payment-provider calls belong in <code>backend/src/services/billing-payments.js</code>; keys stay on the server.
        </p>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Organizations billed" value={paid.length} hint={`of ${rows.length} active`} />
        <MetricCard label="Recurring revenue" value={formatMoney(mrr)} hint="per month, from stored subscriptions" />
        <MetricCard label="Past due" value={rows.filter((r) => r.status === "PAST_DUE").length} tone={rows.some((r) => r.status === "PAST_DUE") ? "amber" : "green"} />
        <MetricCard label="Suspended" value={rows.filter((r) => r.status === "SUSPENDED").length} tone={rows.some((r) => r.status === "SUSPENDED") ? "red" : undefined} hint={`${rows.filter((r) => r.status === "CANCELED").length} canceled`} />
      </div>

      <Tabs tabs={[{ key: "subscriptions", label: "Subscriptions" }, { key: "invoices", label: "Invoices" }, { key: "inquiries", label: "Sales inquiries" }]} value={tab} onChange={setTab} className="mb-4" />
      {tab === "subscriptions" && <Subscriptions rows={rows} onOpen={setOpenId} />}
      {tab === "invoices" && <Invoices />}
      {tab === "inquiries" && <Inquiries />}
      {openId && <OrganizationDrawer orgId={openId} onClose={() => setOpenId(null)} />}
    </>
  )
}

function Subscriptions({ rows, onOpen }) {
  const [search, setSearch] = useState("")
  const shown = rows.filter((r) => `${r.organization} ${r.plan?.name}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <>
      <Toolbar search={search} onSearch={setSearch} placeholder="Search organization or plan…" />
      <DataTable
        loading={!rows.length && search === ""}
        rows={shown}
        rowKey={(r) => r.organizationId}
        onRowClick={(r) => onOpen(r.organizationId)}
        columns={[
          { key: "organization", header: "Organization" },
          { key: "plan", header: "Plan", render: (r) => r.plan?.name || "—", sortValue: (r) => r.plan?.name || "" },
          { key: "status", header: "Status", render: (r) => <StatusPill tone={toneFor(r.status)}>{label(r.status)}</StatusPill> },
          { key: "priceCents", header: "Monthly", render: (r) => (r.priceCents ? formatMoney(r.priceCents, r.currency) : "No charge"), sortValue: (r) => r.priceCents },
          { key: "renews", header: "Renews", hideBelow: "md", render: (r) => (r.priceCents ? fmtDate(r.currentPeriodEnd) : "—"), sortable: false },
          { key: "provider", header: "Provider", hideBelow: "lg", render: (r) => (r.providerLinked ? "Linked" : "Not linked"), sortable: false },
        ]}
      />
    </>
  )
}

function Invoices() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({ queryKey: ["platform", "invoices", page], queryFn: () => platformApi.invoices({ page, pageSize: 25 }) })
  return (
    <DataTable
      loading={isLoading}
      rows={data?.rows || []}
      page={page}
      pageSize={data?.pageSize || 25}
      total={data?.total ?? 0}
      onPageChange={setPage}
      empty={<p className="py-6 text-center text-sm text-muted">No invoices yet. They appear once the payment provider is connected and bills an organization.</p>}
      columns={[
        { key: "number", header: "Invoice" },
        { key: "organization", header: "Organization", render: (i) => i.organization?.name },
        { key: "issuedAt", header: "Issued", render: (i) => fmtDate(i.issuedAt) },
        { key: "amountCents", header: "Amount", render: (i) => formatMoney(i.amountCents, i.currency) },
        { key: "status", header: "Status", render: (i) => <StatusPill tone={toneFor(i.status)}>{label(i.status)}</StatusPill> },
      ]}
    />
  )
}

function Inquiries() {
  const queryClient = useQueryClient()
  const [error, setError] = useState("")
  const { data, isLoading } = useQuery({ queryKey: ["platform", "inquiries"], queryFn: platformApi.inquiries })
  const setStatus = useMutation({
    mutationFn: ({ id, status }) => platformApi.setInquiryStatus(id, status),
    onSuccess: () => { setError(""); queryClient.invalidateQueries({ queryKey: ["platform"] }) },
    onError: (err) => setError(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: (id) => platformApi.deleteInquiry(id),
    onSuccess: () => { setError(""); queryClient.invalidateQueries({ queryKey: ["platform"] }) },
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <>
      {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
      <DataTable
        loading={isLoading}
        rows={data || []}
        actions={(i) => [{ label: "Delete…", icon: Trash2, danger: true, onClick: () => { if (window.confirm(`Delete the inquiry from ${i.name}?`)) remove.mutate(i.id) } }]}
        empty={<p className="py-6 text-center text-sm text-muted">No inquiries yet.</p>}
        columns={[
          { key: "name", header: "From", render: (i) => <div className="min-w-0"><p className="truncate font-medium">{i.name}</p><p className="truncate text-xs text-muted">{i.email}</p></div> },
          { key: "organization", header: "Organization", hideBelow: "md", render: (i) => i.organization?.name || i.company || "—" },
          { key: "employeeCount", header: "Employees", hideBelow: "md" },
          { key: "message", header: "Message", hideBelow: "lg", render: (i) => <span className="line-clamp-2 max-w-xs text-xs text-muted">{i.message}</span>, sortable: false },
          { key: "createdAt", header: "Received", render: (i) => fmtDateTime(i.createdAt) },
          {
            key: "status",
            header: "Status",
            sortable: false,
            render: (i) => (
              <select value={i.status} onChange={(e) => setStatus.mutate({ id: i.id, status: e.target.value })} aria-label={`Status of ${i.name}'s inquiry`} className="field !w-auto !py-1 text-xs">
                <option value="NEW">New</option>
                <option value="CONTACTED">Contacted</option>
                <option value="CLOSED">Closed</option>
              </select>
            ),
          },
        ]}
      />
    </>
  )
}
