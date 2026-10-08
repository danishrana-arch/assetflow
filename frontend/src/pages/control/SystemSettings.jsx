import { useQuery } from "@tanstack/react-query"
import StatusPill from "../../components/ui/StatusPill"
import { FieldValue } from "../../components/ui/Field"
import { platformApi } from "../../api/platform"
import { errorMessage, toneFor } from "../../components/control/shared"
import { SectionTitle } from "./ControlCenterLayout"

const Row = ({ title, status, tone, children }) => (
  <div className="rounded-2xl border border-border bg-surface p-4">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {status && <StatusPill tone={tone}>{status}</StatusPill>}
    </div>
    <div className="grid gap-4 sm:grid-cols-2">{children}</div>
  </div>
)

// Read-only runtime status. Configuration lives in the server's environment
// (backend/.env) — this screen never shows or accepts a secret.
export default function SystemSettings() {
  const { data, isLoading, error } = useQuery({ queryKey: ["platform", "system"], queryFn: platformApi.system })
  if (error) return <p role="alert" className="text-sm text-danger">{errorMessage(error)}</p>
  if (isLoading) return <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />
  const yes = (v) => (v ? "Configured" : "Not configured")
  return (
    <>
      <SectionTitle title="System Settings" subtitle="Read-only status of this deployment. Change values in the server environment." />
      <div className="space-y-3">
        <Row title="Application" status={data.database === "ok" ? "Database OK" : "Database error"} tone={data.database === "ok" ? "green" : "pink"}>
          <FieldValue label="Version" value={data.version} />
          <FieldValue label="Environment" value={data.environment} />
          <FieldValue label="App URL" value={data.appUrl} />
          <FieldValue label="Background jobs" value={data.backgroundJobs.enabled ? "Running" : "Disabled (DISABLE_BACKGROUND_JOBS)"} />
        </Row>
        <Row title="Payments" status={yes(data.payments.configured)} tone={toneFor(data.payments.configured ? "ok" : "warn")}>
          <FieldValue label="Provider" value={data.payments.provider} />
          <FieldValue label="Where it connects" value={data.payments.note} />
        </Row>
        <Row title="Email" status={yes(data.email.configured)} tone={toneFor(data.email.configured ? "ok" : "warn")}>
          <FieldValue label="From address" value={data.email.from} />
          <FieldValue label="Sales inbox" value={data.email.salesInbox ? "Set (SALES_EMAIL)" : "Not set"} />
        </Row>
        <Row title="Platform account">
          <FieldValue label="Access" value="Only the separate Platform Admin account" />
          <FieldValue label="Created with" value="backend/scripts/create-platform-admin.js" />
        </Row>
        <Row title="Feature entitlement">
          <FieldValue label="Cache" value={`Entitlements refresh at most every ${data.cache.entitlementTtlSeconds}s per organization`} />
        </Row>
      </div>
    </>
  )
}
