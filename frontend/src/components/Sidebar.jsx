import { useRef, useState } from "react"
import { NavLink } from "react-router-dom"
import {
  LayoutDashboard,
  Users,
  Boxes,
  ClipboardCheck,
  FolderKanban,
  ListTodo,
  Award,
  MapPin,
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
  BellRing,
  Activity,
  Settings as SettingsIcon,
  Wallet,
  Sun,
  Moon,
  LogOut,
  FileText,
  CalendarRange,
  BadgeCheck,
  Landmark,
  UserRound,
  Mic,
  Speaker,
  Megaphone,
  TrendingUp,
  Handshake,
  PieChart,
  FileBarChart,
  Receipt,
  FileSpreadsheet,
} from "lucide-react"
import { useAuth } from "../context/AuthContext"
import { useTheme } from "../context/ThemeContext"
import { isManagement, hasModuleAccess } from "../utils/roles"
import { useQuery } from "@tanstack/react-query"
import api from "../api/client"
import Avatar from "./ui/Avatar"
import logoFull from "../assets/logo1.png"

// Small pill tooltip shown beside an icon while the rail is still collapsed.
// Positioned via a measured `fixed` coordinate (not `absolute`) because the
// nav list scrolls (`overflow-y-auto`), and a scrolling ancestor forces its
// cross-axis to clip too — an `absolute` tooltip poking out to the right
// would get cut off. `fixed` escapes that clipping entirely. Only rendered
// while `expanded` is false — once the rail opens, the row's own inline
// label takes over, so the two never show at once.
function HoverTooltipAnchor({ label, isDark, expanded, className = "", children }) {
  const [point, setPoint] = useState(null)
  const anchorRef = useRef(null)

  function handleEnter() {
    if (expanded) return
    const rect = anchorRef.current?.getBoundingClientRect()
    if (rect) setPoint({ top: rect.top + rect.height / 2, left: rect.right + 8 })
  }

  function handleLeave() {
    setPoint(null)
  }

  return (
    <span
      ref={anchorRef}
      className={`relative shrink-0 ${className}`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}
      {point && !expanded && (
        <span
          className={`
            pointer-events-none fixed z-50
            -translate-y-1/2 whitespace-nowrap rounded-md
            px-[7px] py-[3px]
            text-[11px] font-normal leading-none
            shadow-sm border
            ${isDark ? "bg-[#1c1c1c] text-white border-black/20" : "bg-white text-black border-black/10"}
          `}
          style={{ top: point.top, left: point.left, fontFamily: "Helvetica, Arial, sans-serif" }}
        >
          {label}
        </span>
      )}
    </span>
  )
}

// Inline label used once the rail is expanded — visibility is driven by the
// `expanded` prop (JS state), not CSS hover, so it can stay in sync with the
// tooltip above (only one of the two is ever visible).
function RailLabel({ children, expanded }) {
  return (
    <span
      className={`
        overflow-hidden whitespace-nowrap
        text-[12px] font-medium
        transition-all duration-300
        ${expanded ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0"}
      `}
    >
      {children}
    </span>
  )
}

function RailItem({ to, label, icon: Icon, end, isDark, expanded, showNotificationDot = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex h-11 w-full shrink-0 items-center gap-3 rounded-full pl-2.5 pr-3 transition-colors duration-200 active:scale-[0.97] ${
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
      <HoverTooltipAnchor
        label={label}
        isDark={isDark}
        expanded={expanded}
        className="flex h-7 w-7 items-center justify-center"
      >
        <Icon size={19} strokeWidth={2} />
        {showNotificationDot && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-danger ring-2 ring-transparent" />
        )}
      </HoverTooltipAnchor>

      <RailLabel expanded={expanded}>{label}</RailLabel>
    </NavLink>
  )
}

// `expanded`/`onMouseEnter`/`onMouseLeave` are owned by DashboardLayout, not
// this component — the page content needs to shift in sync with the rail
// opening, so the hover-intent state has to live one level up where both
// the sidebar and the main content wrapper can read it.
export default function Sidebar({ expanded, onMouseEnter, onMouseLeave }) {
  const { logout, user } = useAuth()
  const { mode, toggleMode } = useTheme()

  const isAdmin = isManagement(user?.role)
  const isIT = user?.role === "IT_MANAGER"
  const isOwner = ["ADMIN", "CEO"].includes(user?.role)
  const isDark = mode === "dark"

  const canManageAttendance =
    hasModuleAccess(user?.role, "attendance") || !!user?.canManageAttendance

  const { data: unreadNotifications } = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: () => api.get("/notifications/unread-count").then((r) => r.data),
    refetchInterval: 15000,
    staleTime: 5000,
  })

  const hasUnreadNotifications = Number(unreadNotifications?.count || 0) > 0

  return (
    <aside
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`
        fixed left-4 top-6 bottom-6 z-40 hidden
        flex-col items-stretch
        rounded-[26px]
        py-6
        transition-[width] duration-300 ease-out
        lg:flex
        backdrop-blur-2xl
        backdrop-saturate-150
        ${expanded ? "w-60" : "w-[72px]"}
        ${
          isDark
            ? `
              bg-white/75
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
        backgroundImage: isDark
          ? "linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 22%)"
          : "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 22%)",
        boxShadow: isDark
          ? "0 8px 32px rgba(0,0,0,0.10), inset 0 1px 1px rgba(255,255,255,0.45)"
          : "0 8px 32px rgba(0,0,0,0.18), inset 0 1px 1px rgba(255,255,255,0.12)",
      }}
    >
      <div className="mb-4 flex w-full shrink-0 items-center gap-3 pl-4 pr-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
          <img
            src={logoFull}
            alt="AssetFlow"
            className="
              h-9 w-9
              object-contain
              rounded-xl
              drop-shadow-sm
            "
          />
        </div>
        <span
          className={`
            overflow-hidden whitespace-nowrap
            text-sm font-bold tracking-tight
            transition-all duration-300
            ${expanded ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0"}
          `}
        >
          AssetFlow
        </span>
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
              expanded={expanded}
            />

            {hasModuleAccess(user?.role, "inventory") && (
              <RailItem to="/inventory" label="Inventory" icon={Boxes} isDark={isDark} expanded={expanded} />
            )}

            {hasModuleAccess(user?.role, "employees") && (
              <RailItem to="/employees" label="Employees" icon={Users} isDark={isDark} expanded={expanded} />
            )}

             {canManageAttendance && (
              <>
                <RailItem to="/attendance" label="Attendance" icon={CalendarCheck} isDark={isDark} expanded={expanded} end />
                <RailItem to="/attendance/sites" label="Attendance Sites" icon={MapPin} isDark={isDark} expanded={expanded} />
              </>
            )}

            <RailItem
              to="/attendance/me"
              label="My Attendance"
              icon={UserCheck}
              isDark={isDark}
              expanded={expanded}
            />

 <RailItem to="/calendar" label="Company Calendar" icon={CalendarRange} isDark={isDark} expanded={expanded} />
            {isOwner && <RailItem to="/organization-comparison" label="Organization Comparison" icon={Landmark} isDark={isDark} expanded={expanded} />}

            {hasModuleAccess(user?.role, "sales") && (
              <RailItem to="/sales" label="Sales" icon={TrendingUp} isDark={isDark} expanded={expanded} />
            )}
            {hasModuleAccess(user?.role, "salesTeam") && (
              <RailItem to="/sales-team" label="Sales Team" icon={Handshake} isDark={isDark} expanded={expanded} />
            )}

            {hasModuleAccess(user?.role, "projects") && (
              <RailItem to="/projects" label="Projects" icon={FolderKanban} isDark={isDark} expanded={expanded} />
            )}

            {hasModuleAccess(user?.role, "tasks") && (
              <RailItem to="/tasks" label="Tasks" icon={ListTodo} isDark={isDark} expanded={expanded} />
            )}
            {hasModuleAccess(user?.role, "performance") && (
              <RailItem to="/performance" label="Performance" icon={Award} isDark={isDark} expanded={expanded} />
            )}

             <RailItem
              to="/announcements"
              label="Announcements"
              icon={Megaphone}
              isDark={isDark}
              expanded={expanded}
            />

            {hasModuleAccess(user?.role, "departments") && (
              <RailItem to="/departments" label="Departments" icon={Building2} isDark={isDark} expanded={expanded} />
            )}

            {hasModuleAccess(user?.role, "assetRequests") && (
              <RailItem to="/asset-requests" label="Asset Requests" icon={PackageSearch} isDark={isDark} expanded={expanded} />
            )}

            {hasModuleAccess(user?.role, "assetAssignments") && (
              <RailItem to="/assignments" label="Assignments" icon={ClipboardCheck} isDark={isDark} expanded={expanded} />
            )}

            <RailItem
              to="/tickets"
              label="Tickets"
              icon={Ticket}
              isDark={isDark}
              expanded={expanded}
            />

            {hasModuleAccess(user?.role, "leave") && (
              <RailItem to="/leave-requests" label="Leave Requests" icon={ClipboardList} isDark={isDark} expanded={expanded} />
            )}

            {hasModuleAccess(user?.role, "reports") && (
              <>
                <RailItem to="/reports" label="Reports" icon={BarChart3} isDark={isDark} expanded={expanded} />
                <RailItem to="/export" label="Export" icon={Download} isDark={isDark} expanded={expanded} />
              </>
            )}

            {hasModuleAccess(user?.role, "salesReports") && (
              <RailItem to="/reports/sales" label="Sales Reports" icon={PieChart} isDark={isDark} expanded={expanded} />
            )}
            {hasModuleAccess(user?.role, "hrReports") && (
              <RailItem to="/reports/hr" label="HR Reports" icon={FileBarChart} isDark={isDark} expanded={expanded} />
            )}
            {hasModuleAccess(user?.role, "financialReports") && (
              <RailItem to="/reports/financial" label="Financial Reports" icon={Receipt} isDark={isDark} expanded={expanded} />
            )}

            {isOwner && (
              <RailItem
                to="/audit-log"
                label="Audit Log"
                icon={ShieldCheck}
                isDark={isDark}
                expanded={expanded}
              />
            )}

            {/* Activity - different icon from Announcements */}
            <RailItem
              to="/notifications"
              label="Activity"
              icon={BellRing}
              isDark={isDark}
              expanded={expanded}
              showNotificationDot={hasUnreadNotifications}
            />

            {hasModuleAccess(user?.role, "employeeForms") && (
              <RailItem
                to="/employee-forms"
                label="Employee Forms"
                icon={FileText}
                isDark={isDark}
                expanded={expanded}
              />
            )}

            {isOwner && (
              <RailItem
                to="/settings"
                label="Settings"
                icon={SettingsIcon}
                isDark={isDark}
                expanded={expanded}
              />
            )}

            {hasModuleAccess(user?.role, "payroll") && (
              <>
                <RailItem to="/payroll" label="Payroll" icon={Wallet} isDark={isDark} expanded={expanded} />
                <RailItem to="/payroll/reports" label="Payroll Reports" icon={FileSpreadsheet} isDark={isDark} expanded={expanded} />
              </>
            )}
          </>
        ) : isIT ? (
          <>
            <RailItem to="/" label="Dashboard" icon={LayoutDashboard} end isDark={isDark} expanded={expanded} />
            <RailItem to="/inventory" label="Inventory" icon={Boxes} isDark={isDark} expanded={expanded} />
            <RailItem to="/employees" label="Employees & Assets" icon={Users} isDark={isDark} expanded={expanded} />
            <RailItem to="/assignments" label="Asset Assignments" icon={ClipboardCheck} isDark={isDark} expanded={expanded} />
            <RailItem to="/asset-requests" label="Asset Requests" icon={PackageSearch} isDark={isDark} expanded={expanded} />
            <RailItem to="/tickets" label="Requests / Tickets" icon={Ticket} isDark={isDark} expanded={expanded} />
            <RailItem to="/calendar" label="Company Calendar" icon={CalendarDays} isDark={isDark} expanded={expanded} />
            <RailItem to="/attendance/me" label="My Attendance" icon={CalendarCheck} isDark={isDark} expanded={expanded} />
            <RailItem to="/notifications" label="Notifications" icon={Activity} isDark={isDark} expanded={expanded} showNotificationDot={hasUnreadNotifications} />
          </>
        ) : (
          <>
            <RailItem
              to={`/employees/${user?.id}`}
              label="My Profile"
              icon={UserRound}
              isDark={isDark}
              expanded={expanded}
            />

            <RailItem
              to="/projects"
              label="My Projects"
              icon={FolderKanban}
              isDark={isDark}
              expanded={expanded}
            />

            <RailItem
              to="/attendance/me"
              label="My Attendance"
              icon={CalendarCheck}
              isDark={isDark}
              expanded={expanded}
            />

            <RailItem to="/calendar" label="Company Calendar" icon={CalendarRange} isDark={isDark} expanded={expanded} />
            <RailItem to={`/employee-360/${user?.id}`} label="My Employee 360°" icon={BadgeCheck} isDark={isDark} expanded={expanded} />

            <RailItem to="/tasks" label="My Tasks" icon={ListTodo} isDark={isDark} expanded={expanded} />
            <RailItem to="/performance" label="My Performance" icon={Award} isDark={isDark} expanded={expanded} />
            <RailItem to="/announcements" label="Announcements" icon={Megaphone} isDark={isDark} expanded={expanded} />

            <RailItem
              to="/payroll/me"
              label="My Payslips"
              icon={Wallet}
              isDark={isDark}
              expanded={expanded}
            />

            <RailItem
              to="/tickets"
              label="Tickets"
              icon={Ticket}
              isDark={isDark}
              expanded={expanded}
            />

            <RailItem
              to="/notifications"
              label="Notifications"
              icon={BellRing}
              isDark={isDark}
              expanded={expanded}
              showNotificationDot={hasUnreadNotifications}
            />
          </>
        )}
      </nav>

      {/* Bottom Controls — px-3 matches <nav>'s own padding so these icons
          land on the exact same vertical axis as the nav icons above. */}
      <div className="mt-2 flex shrink-0 flex-col items-center gap-1.5 px-3">
        {/* Theme Toggle */}
        <button
          onClick={toggleMode}
          className={`
            flex h-11 w-full shrink-0
            items-center gap-3
            rounded-full pl-2.5 pr-3
            transition-colors duration-200
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
        >
          <HoverTooltipAnchor
            label={isDark ? "Light mode" : "Dark mode"}
            isDark={isDark}
            expanded={expanded}
            className="flex h-7 w-7 items-center justify-center"
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </HoverTooltipAnchor>
          <RailLabel expanded={expanded}>{isDark ? "Light mode" : "Dark mode"}</RailLabel>
        </button>

        {/* Logout */}
        <button
          onClick={logout}
          className={`
            flex h-11 w-full shrink-0
            items-center gap-3
            rounded-full pl-2.5 pr-3
            transition-colors duration-200
            ${
              isDark
                ? "text-black/55 hover:bg-pink-100 hover:text-pink-600"
                : "text-white/60 hover:bg-chip-pink-bg hover:text-chip-pink-fg"
            }
          `}
          aria-label="Logout"
        >
          <HoverTooltipAnchor
            label="Logout"
            isDark={isDark}
            expanded={expanded}
            className="flex h-7 w-7 items-center justify-center"
          >
            <LogOut size={16} />
          </HoverTooltipAnchor>
          <RailLabel expanded={expanded}>Logout</RailLabel>
        </button>

        {/* Account */}
        <NavLink
          to="/profile"
          className="mt-1 flex h-11 w-full shrink-0 items-center gap-3 rounded-full pl-2 pr-3"
        >
          <HoverTooltipAnchor
            label="My Account"
            isDark={isDark}
            expanded={expanded}
            className="flex h-8 w-8 items-center justify-center"
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
          </HoverTooltipAnchor>
          <RailLabel expanded={expanded}>{user?.name || "My Account"}</RailLabel>
        </NavLink>
      </div>
    </aside>
  )
}
