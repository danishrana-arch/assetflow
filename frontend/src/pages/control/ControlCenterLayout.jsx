import { NavLink, Outlet } from "react-router-dom"
import { Activity, Building2, CreditCard, Gauge, LayoutDashboard, Layers, Receipt, ScrollText, Settings2, ShieldCheck, Users } from "lucide-react"

const SECTIONS = [
  { to: "/control-center", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/control-center/organizations", label: "Organizations", icon: Building2 },
  { to: "/control-center/users", label: "Users", icon: Users },
  { to: "/control-center/roles", label: "Roles & Permissions", icon: ShieldCheck },
  { to: "/control-center/features", label: "Features", icon: Layers },
  { to: "/control-center/plans", label: "Plans", icon: CreditCard },
  { to: "/control-center/billing", label: "Billing", icon: Receipt },
  { to: "/control-center/usage", label: "Usage", icon: Gauge },
  { to: "/control-center/audit", label: "Audit Logs", icon: ScrollText },
  { to: "/control-center/system", label: "System Settings", icon: Settings2 },
]

// Shell for every Control Center screen: a section list on the left (a
// scrolling strip on phones) and the active screen on the right.
export default function ControlCenterLayout() {
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <Activity size={22} className="text-ink" />
        <div>
          <h1 className="text-xl font-semibold text-ink" style={{ letterSpacing: "-0.01em" }}>Control Center</h1>
          <p className="text-sm text-muted">Platform administration across every organization.</p>
        </div>
      </div>
      <div className="flex flex-col gap-5 lg:flex-row">
        <nav aria-label="Control Center sections" className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto lg:sticky lg:top-4 lg:w-52 lg:flex-col lg:self-start lg:overflow-visible">
          {SECTIONS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isActive ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2/60 hover:text-ink"
                }`
              }
            >
              <Icon size={16} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export function SectionTitle({ title, subtitle, actions }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-ink" style={{ letterSpacing: "-0.01em" }}>{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}
