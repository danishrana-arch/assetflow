import { NavLink } from "react-router-dom"
import {
  LayoutDashboard,
  Users,
  Boxes,
  ClipboardCheck,
  FolderKanban,
  PackageSearch,
  Building2,
  Ticket,
  BarChart3,
  Download,
  CalendarCheck,
  CalendarDays,
  UserCheck,
  ClipboardList,
  ShieldCheck,
  Bell,
  Settings as SettingsIcon,
  Wallet,
  Sun,
  Moon,
  LogOut,
} from "lucide-react"
import { useAuth } from "../context/AuthContext"
import { useTheme } from "../context/ThemeContext"
import { isManagement } from "../utils/roles"
import Avatar from "./ui/Avatar"
import logoFull from "../assets/logo1.png"

function RailItem({ to, label, icon: Icon, end, isDark }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive }) =>
        `group relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all duration-200 active:scale-90 ${
          isActive
            ? "text-[var(--on-primary-container)]"
            : isDark
          ? "text-black/55 hover:bg-black/10 hover:text-black"
          : "text-white/60 hover:bg-white/10 hover:text-white"
        }`
      }
      style={({ isActive }) =>
        isActive
          ? {
              backgroundColor: "var(--primary-container)",
              boxShadow: "inset 0 1px 1px rgba(255,255,255,0.18)",
            }
          : undefined
      }
    >
      <Icon size={19} strokeWidth={2} />

      <span
        className={`
          pointer-events-none absolute left-full ml-3 z-40
          whitespace-nowrap rounded-lg
          px-2.5 py-1.5
          text-[11px] font-medium
          opacity-0 shadow-md
          transition-opacity
          group-hover:opacity-100
          backdrop-blur-xl
          border
          ${
            isDark
              ? "bg-white/90 text-black border-black/10"
              : "bg-black/80 text-white border-white/10"
          }
        `}
      >
        {label}
      </span>
    </NavLink>
  )
}

export default function Sidebar() {
  const { logout, user } = useAuth()
  const { mode, toggleMode } = useTheme()

  const isAdmin = isManagement(user?.role)
  const isOwner = ["ADMIN", "CEO"].includes(user?.role)
  const isDark = mode === "dark"

  const canManageAttendance =
    ["ADMIN", "CEO"].includes(user?.role) || !!user?.canManageAttendance

  return (
    <aside
      className={`
        fixed left-4 top-1/2 z-40 hidden
        -translate-y-1/2
        flex-col items-center
        rounded-full
        py-6
        transition-all duration-300
        lg:flex
        backdrop-blur-2xl
        backdrop-saturate-150
        ${
          isDark
            ? `
              bg-white/70
              border border-white/80
              text-black
            `
            : `
              bg-[#111313]/75
              border border-white/10
              text-white
            `
        }
      `}
      style={{
        maxHeight: "calc(100vh - 48px)",
        boxShadow: isDark
          ? "0 8px 32px rgba(0,0,0,0.10), inset 0 1px 1px rgba(255,255,255,0.45)"
          : "0 8px 32px rgba(0,0,0,0.18), inset 0 1px 1px rgba(255,255,255,0.12)",
      }}
    >

      <div
        className={`
          mb-4
          flex h-10 w-10 shrink-0
          items-center justify-center
          rounded-full
          transition-all duration-300
        `}
      >
        <img
          src={logoFull}
          alt="AssetFlow"
          className="
            h-9 w-9
            object-contain
            rounded-xl
            drop-shadow-sm
            transition-transform duration-300
          "
        />
      </div>

      <nav
        className="
          flex flex-1
          flex-col items-center
          gap-1.5
          overflow-y-auto
          px-3 py-1
          [scrollbar-width:none]
          [&::-webkit-scrollbar]:hidden
        "
      >
        {isAdmin ? (
          <>
            <RailItem
              to="/"
              label="Dashboard"
              icon={LayoutDashboard}
              end
              isDark={isDark}
            />

            <RailItem
              to="/inventory"
              label="Inventory"
              icon={Boxes}
              isDark={isDark}
            />

            <RailItem
              to="/employees"
              label="Employees"
              icon={Users}
              isDark={isDark}
            />

            <RailItem
              to="/assignments"
              label="Assignments"
              icon={ClipboardCheck}
              isDark={isDark}
            />

            <RailItem
              to="/projects"
              label="Projects"
              icon={FolderKanban}
              isDark={isDark}
            />

            <RailItem
              to="/asset-requests"
              label="Asset Requests"
              icon={PackageSearch}
              isDark={isDark}
            />

            <RailItem
              to="/departments"
              label="Departments"
              icon={Building2}
              isDark={isDark}
            />

            <RailItem
              to="/tickets"
              label="Tickets"
              icon={Ticket}
              isDark={isDark}
            />

            {canManageAttendance && (
              <RailItem
                to="/attendance"
                label="Attendance"
                icon={CalendarCheck}
                isDark={isDark}
              />
            )}

            <RailItem
              to="/attendance/me"
              label="My Attendance"
              icon={UserCheck}
              isDark={isDark}
            />

            <RailItem
              to="/leave-requests"
              label="Leave Requests"
              icon={ClipboardList}
              isDark={isDark}
            />

            <RailItem
              to="/leave-calendar"
              label="Leave Calendar"
              icon={CalendarDays}
              isDark={isDark}
            />

            <RailItem
              to="/reports"
              label="Reports"
              icon={BarChart3}
              isDark={isDark}
            />

            <RailItem
              to="/export"
              label="Export"
              icon={Download}
              isDark={isDark}
            />

            <RailItem
              to="/audit-log"
              label="Audit Log"
              icon={ShieldCheck}
              isDark={isDark}
            />

            <RailItem
              to="/notifications"
              label="Activity"
              icon={Bell}
              isDark={isDark}
            />

            {isOwner && (
              <RailItem
                to="/settings"
                label="Settings"
                icon={SettingsIcon}
                isDark={isDark}
              />
            )}

            <RailItem
              to="/payroll"
              label="Payroll"
              icon={Wallet}
              isDark={isDark}
            />

          </>
        ) : (
          <>
            <RailItem
              to={`/employees/${user?.id}`}
              label="My Profile"
              icon={Users}
              isDark={isDark}
            />

            <RailItem
              to="/projects"
              label="My Projects"
              icon={FolderKanban}
              isDark={isDark}
            />

            <RailItem
              to="/attendance/me"
              label="My Attendance"
              icon={CalendarCheck}
              isDark={isDark}
            />

            <RailItem
              to="/payroll/me"
              label="My Payslips"
              icon={Wallet}
              isDark={isDark}
            />

            <RailItem
              to="/tickets"
              label="Tickets"
              icon={Ticket}
              isDark={isDark}
            />
          </>
        )}
      </nav>

      {/* Bottom Controls */}
      <div className="mt-2 flex shrink-0 flex-col items-center gap-1.5">
        {/* Theme Toggle */}
        <button
          onClick={toggleMode}
          className={`
            flex h-9 w-9
            items-center justify-center
            rounded-full
            transition-all duration-200
            ${
              isDark
                ? "text-black/55 hover:bg-black/10 hover:text-black"
                : "text-white/60 hover:bg-white/10 hover:text-white"
            }
          `}
          aria-label={
            isDark
              ? "Switch to light mode"
              : "Switch to dark mode"
          }
          title={
            isDark
              ? "Light mode"
              : "Dark mode"
          }
        >
          {isDark ? (
            <Sun size={16} />
          ) : (
            <Moon size={16} />
          )}
        </button>

        {/* Logout */}
        <button
          onClick={logout}
          className={`
            flex h-9 w-9
            items-center justify-center
            rounded-full
            transition-all duration-200
            ${
              isDark
                ? "text-black/55 hover:bg-pink-100 hover:text-pink-600"
                : "text-white/60 hover:bg-chip-pink-bg hover:text-chip-pink-fg"
            }
          `}
          aria-label="Logout"
          title="Logout"
        >
          <LogOut size={16} />
        </button>

        {/* Account */}
        <NavLink
          to="/profile"
          title="My Account"
          className="mt-1 block"
        >
          <Avatar
            name={user?.name || "?"}
            size="sm"
            className={`
              border-2
              ${
                isDark
                  ? "border-black/10"
                  : "border-white/20"
              }
            `}
          />
        </NavLink>
      </div>
    </aside>
  )
}