import { NavLink } from "react-router-dom"
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  Boxes,
  ClipboardCheck,
  PackageSearch,
  Building2,
  Ticket,
  BarChart3,
  Download,
  CalendarCheck,
  CalendarDays,
  UserCheck,
  Bell,
  Settings,
  Wallet,
  ClipboardList,
  ShieldCheck,
  UserCircle,
  LogOut,
  X,
} from "lucide-react"
import { useAuth } from "../context/AuthContext"
import { isManagement, canAccessPayroll } from "../utils/roles"
import OrganizationSwitcher from "./OrganizationSwitcher"

function Row({ to, icon: Icon, label, end, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors ${
          isActive ? "bg-accent text-white" : "text-muted hover:bg-surface-2 hover:text-ink"
        }`
      }
    >
      <Icon size={17} />
      <span>{label}</span>
    </NavLink>
  )
}

export default function MobileNav({ open, onClose }) {
  const { user, logout } = useAuth()
  const isAdmin = isManagement(user?.role)
  const isIT = user?.role === "IT_MANAGER"
  if (!open) return null

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-black/40 lg:hidden" aria-hidden="true" />
      <aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-surface p-3 shadow-card-lg lg:hidden">
        <div className="mb-4 flex items-center justify-between px-1">
          <span className="text-sm font-semibold text-ink">Menu</span>
          <button onClick={onClose} className="text-muted" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        {(["ADMIN", "CEO"].includes(user?.role)) && (
          <div className="mb-3 rounded-2xl border border-border bg-surface-2 p-3">
            <OrganizationSwitcher />
          </div>
        )}
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {isAdmin ? (
            <>
              <Row to="/" icon={LayoutDashboard} label="Dashboard" end onClick={onClose} />
              <Row to="/inventory" icon={Boxes} label="Inventory" onClick={onClose} />
              <Row to="/employees" icon={Users} label="Employees" onClick={onClose} />
              <Row to="/assignments" icon={ClipboardCheck} label="Asset Assignment" onClick={onClose} />
              <Row to="/projects" icon={FolderKanban} label="Projects" onClick={onClose} />
              <Row to="/asset-requests" icon={PackageSearch} label="Asset Requests" onClick={onClose} />
              <Row to="/departments" icon={Building2} label="Departments" onClick={onClose} />
              <Row to="/tickets" icon={Ticket} label="Requests / Tickets" onClick={onClose} />
              {(["ADMIN", "CEO", "HR"].includes(user?.role) || user?.canManageAttendance) && (
                <Row to="/attendance" icon={CalendarCheck} label="Attendance" onClick={onClose} />
              )}
              <Row to="/attendance/me" icon={UserCheck} label="My Attendance" onClick={onClose} />
              <Row to="/leave-requests" icon={ClipboardList} label="Leave Requests" onClick={onClose} />
              <Row to="/leave-calendar" icon={CalendarDays} label="Leave Calendar" onClick={onClose} />
              <Row to="/reports" icon={BarChart3} label="Reports" onClick={onClose} />
              <Row to="/export" icon={Download} label="Export" onClick={onClose} />
              <Row to="/audit-log" icon={ShieldCheck} label="Audit Log" onClick={onClose} />
              {canAccessPayroll(user?.role) && <Row to="/payroll" icon={Wallet} label="Payroll" onClick={onClose} />}
              <div className="my-2 divider" />
              <Row to="/notifications" icon={Bell} label="Notifications" onClick={onClose} />
              <Row to="/settings" icon={Settings} label="Settings" onClick={onClose} />
              <Row to="/holidays" icon={CalendarDays} label="Holidays" onClick={onClose} />
              <Row to="/profile" icon={UserCircle} label="Profile" onClick={onClose} />
            </>
          ) : isIT ? (
            <>
              <Row to="/" icon={LayoutDashboard} label="Dashboard" end onClick={onClose} />
              <Row to="/inventory" icon={Boxes} label="Inventory" onClick={onClose} />
              <Row to="/employees" icon={Users} label="Employees & Assets" onClick={onClose} />
              <Row to="/assignments" icon={ClipboardCheck} label="Asset Assignments" onClick={onClose} />
              <Row to="/asset-requests" icon={PackageSearch} label="Asset Requests" onClick={onClose} />
              <Row to="/tickets" icon={Ticket} label="Requests / Tickets" onClick={onClose} />
            </>
          ) : (
            <>
              <Row to={`/employees/${user?.id}`} icon={UserCircle} label="My Profile" onClick={onClose} />
              <Row to="/projects" icon={FolderKanban} label="My Projects" onClick={onClose} />
              <Row to="/attendance/me" icon={CalendarCheck} label="My Attendance" onClick={onClose} />
              <Row to="/payroll/me" icon={Wallet} label="My Payslips" onClick={onClose} />
              <Row to="/tickets" icon={Ticket} label="Tickets" onClick={onClose} />
            </>
          )}
        </nav>
        <button
          onClick={() => { logout(); onClose() }}
          className="mt-3 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-muted hover:bg-chip-pink-bg hover:text-chip-pink-fg"
        >
          <LogOut size={17} /> Logout
        </button>
      </aside>
    </>
  )
}