import { Check, Sparkles } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"

const PLANS = [
  {
    tier: "FREE", name: "Free", price: "$0", period: "forever", tone: "slate",
    features: ["10 Employees", "50 Assets", "Basic Dashboard", "Manual Assignment", "Employee Profiles", "Email Support"],
  },
  {
    tier: "PRO", name: "Pro", price: "$15", period: "per user / month", tone: "blue",
    features: ["Unlimited Employees", "Unlimited Assets", "Excel Import/Export", "Ticket System", "Reports", "Custom Branding", "Audit Logs", "Asset History", "Email Notifications", "Department Mgmt"],
  },
  {
    tier: "BUSINESS", name: "Business", price: "$49", period: "per user / month", tone: "purple", highlight: true,
    features: ["Everything in Pro", "Multiple Admins", "QR Code Assets", "Barcode Support", "Approval Workflow", "Asset Lifecycle", "Warranty Tracking", "Advanced Reports", "API Access", "Scheduled Backups"],
  },
  {
    tier: "ENTERPRISE", name: "Enterprise", price: "Custom", period: "annual", tone: "cyan",
    features: ["Unlimited Organizations", "SSO", "Azure Login", "Google Workspace", "Slack & Teams", "Custom Domain", "White Label", "Dedicated Database"],
  },
]

export default function Billing() {
  const { data: organization } = useQuery({
    queryKey: ["organization"],
    queryFn: () => api.get("/organization").then((r) => r.data),
  })

  return (
    <div>
      <PageHeader title="Plans & Billing" subtitle="Choose the plan that fits your team." backTo="/" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((plan) => {
          const isCurrent = organization?.planTier === plan.tier
          const isHighlight = plan.highlight
          return (
            <div
              key={plan.tier}
              className={`card relative p-6 ${isHighlight ? "ring-2 ring-accent" : ""}`}
            >
              {isHighlight && (
                <span className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full bg-chip-purple-bg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-chip-purple-fg">
                  <Sparkles size={11} />
                  Popular
                </span>
              )}
              {isCurrent && (
                <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-chip-green-bg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-chip-green-fg">
                  Current plan
                </span>
              )}
              <h3 className="text-lg font-semibold text-ink" style={{ letterSpacing: "-0.02em" }}>
                {plan.name}
              </h3>
              <p className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-semibold text-ink" style={{ letterSpacing: "-0.03em" }}>
                  {plan.price}
                </span>
                <span className="text-xs text-muted">/ {plan.period}</span>
              </p>

              <ul className="mt-5 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-muted">
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-chip-${plan.tone}-bg text-chip-${plan.tone}-fg`}>
                      <Check size={10} strokeWidth={3} />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                disabled={isCurrent}
                className={`mt-6 w-full rounded-full py-2.5 text-sm font-semibold transition-opacity ${
                  isCurrent
                    ? "bg-surface-2 text-muted"
                    : isHighlight
                    ? "pill-accent"
                    : "pill-primary"
                }`}
              >
                {isCurrent ? "Current plan" : "Upgrade"}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
