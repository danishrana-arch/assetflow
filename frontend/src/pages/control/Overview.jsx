import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { AlertTriangle, Building2, CreditCard, Inbox, Users } from "lucide-react"
import MetricCard from "../../components/ui/MetricCard"
import { platformApi } from "../../api/platform"
import { actionLabel, errorMessage, fmtDateTime } from "../../components/control/shared"
import { SectionTitle } from "./ControlCenterLayout"

export default function Overview() {
  const { data, isLoading, error } = useQuery({ queryKey: ["platform", "overview"], queryFn: platformApi.overview })
  if (error) return <p role="alert" className="text-sm text-danger">{errorMessage(error)}</p>
  if (isLoading) return <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />

  const { organizations: o, limits } = data
  return (
    <>
      <SectionTitle title="Overview" subtitle="Live totals across the whole platform." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={Building2} label="Organizations" value={o.total} hint={`${o.active} active · ${o.archived} archived · ${o.groups} ${o.groups === 1 ? "group" : "groups"}`} />
        <MetricCard icon={Users} label="Active users" value={data.users} />
        <MetricCard
          icon={CreditCard}
          label="Paid subscriptions"
          value={data.paidOrganizations}
          hint={data.paymentsConfigured ? undefined : "Payments not connected"}
        >
          <ul className="space-y-1">
            {Object.entries(data.plans).map(([name, n]) => (
              <li key={name} className="flex justify-between"><span>{name}</span><span className="tabular-nums text-muted">{n}</span></li>
            ))}
          </ul>
        </MetricCard>
        <MetricCard icon={Inbox} label="New sales inquiries" value={data.newInquiries} tone={data.newInquiries ? "blue" : undefined} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <MetricCard icon={AlertTriangle} label="Approaching a plan limit" value={limits.warning} tone={limits.warning ? "amber" : "green"} hint="80% or more of a limit" />
        <MetricCard icon={AlertTriangle} label="At or over a plan limit" value={limits.atOrOverLimit} tone={limits.atOrOverLimit ? "red" : "green"} />
      </div>
      {(limits.warning > 0 || limits.atOrOverLimit > 0) && (
        <p className="mt-2 text-sm"><Link to="/control-center/usage" className="font-semibold text-accent hover:underline">See which organizations →</Link></p>
      )}

      <section className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Recent platform activity</h3>
        {data.recentActivity.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">Nothing yet. Changes made in the Control Center show up here.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {data.recentActivity.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5 text-sm">
                <span className="font-medium capitalize text-ink">{actionLabel(e.action)}</span>
                <span className="text-muted">{e.organization?.name}</span>
                <span className="text-muted">by {e.actor?.name || "System"}</span>
                <span className="ml-auto text-xs text-muted">{fmtDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-sm"><Link to="/control-center/audit" className="font-semibold text-accent hover:underline">Open the audit log →</Link></p>
      </section>
    </>
  )
}
