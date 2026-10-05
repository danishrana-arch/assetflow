import {
  LayoutDashboard,
  Users,
  Boxes,
  ClipboardCheck,
  FolderKanban,
  Award,
  MapPin,
  PackageSearch,
  Building2,
  Ticket,
  CalendarCheck,
  CalendarDays,
  UserCheck,
  ClipboardList,
  ShieldCheck,
  Settings,
  Wallet,
  FileText,
  CalendarRange,
  Landmark,
  UserRound,
  Megaphone,
  FileSpreadsheet,
  FileBarChart,
  Receipt,
  HardHat,
} from "lucide-react"
import { isManagement, hasModuleAccess } from "./roles"

// The one navigation list, grouped by area. Both the desktop Sidebar and the
// MobileNav render it, so every screen size always shows the same pages.
// Each item's gate mirrors that page's route guard in App.jsx.
export function navGroups(user) {
  const role = user?.role
  const can = (moduleKey) => hasModuleAccess(role, moduleKey)
  const isOwner = ["ADMIN", "CEO"].includes(role)
  const keep = (groups) =>
    groups
      .map((g) => ({ ...g, items: g.items.filter((item) => item.show !== false) }))
      .filter((g) => g.items.length)

  if (isManagement(role)) {
    const canManageAttendance = can("attendance") || !!user?.canManageAttendance
    return keep([
      {
        label: "Overview",
        items: [
          { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
          { to: "/calendar", label: "Company Calendar", icon: CalendarRange },
          { to: "/announcements", label: "Announcements", icon: Megaphone },
        ],
      },
      {
        label: "People",
        items: [
          { to: "/employees", label: "Employees", icon: Users, show: can("employees") },
          { to: "/departments", label: "Departments", icon: Building2, show: can("departments") },
          { to: "/employee-forms", label: "Employee Forms", icon: FileText, show: can("employeeForms") },
        ],
      },
      {
        label: "Attendance & Leave",
        items: [
          { to: "/attendance", label: "Attendance", icon: CalendarCheck, end: true, show: canManageAttendance },
          { to: "/attendance/sites", label: "Attendance Sites", icon: MapPin, show: canManageAttendance },
          { to: "/leave-requests", label: "Leave Requests", icon: ClipboardList, show: can("leave") },
          { to: "/holidays", label: "Holidays", icon: CalendarDays, show: can("leave") },
          { to: "/attendance/me", label: "My Attendance", icon: UserCheck },
        ],
      },
      {
        label: "Work",
        items: [
          { to: "/projects", label: "Projects & Tasks", icon: FolderKanban, show: can("projects") },
          { to: "/performance", label: "Performance", icon: Award, show: can("performance") },
          { to: "/tickets", label: "Tickets", icon: Ticket },
        ],
      },
      {
        label: "Assets",
        items: [
          { to: "/inventory", label: "Inventory", icon: Boxes, show: can("inventory") },
          { to: "/assignments", label: "Assignments", icon: ClipboardCheck, show: can("assetAssignments") },
          { to: "/asset-requests", label: "Asset Requests", icon: PackageSearch, show: can("assetRequests") },
        ],
      },
      {
        label: "Payroll",
        items: [
          { to: "/payroll", label: "Payroll", icon: Wallet, show: can("payroll") },
          { to: "/payroll/reports", label: "Payroll Reports", icon: FileSpreadsheet, show: can("payrollReports") },
          { to: "/payroll/me", label: "My Payslips", icon: Receipt },
        ],
      },
      {
        label: "Reports & Admin",
        items: [
          { to: "/reports/hr", label: "HR Reports", icon: FileBarChart, show: can("hrReports") },
          { to: "/organization-comparison", label: "Organization Comparison", icon: Landmark, show: isOwner },
          { to: "/audit-log", label: "Audit Log", icon: ShieldCheck, show: isOwner },
          { to: "/settings", label: "Settings", icon: Settings, show: isOwner },
        ],
      },
    ])
  }

  if (role === "IT_MANAGER") {
    return keep([
      {
        label: "Overview",
        items: [
          { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
          { to: "/calendar", label: "Company Calendar", icon: CalendarRange },
        ],
      },
      {
        label: "Assets",
        items: [
          { to: "/inventory", label: "Inventory", icon: Boxes },
          { to: "/employees", label: "Employees & Assets", icon: Users },
          { to: "/assignments", label: "Asset Assignments", icon: ClipboardCheck },
          { to: "/asset-requests", label: "Asset Requests", icon: PackageSearch },
          { to: "/tickets", label: "Requests / Tickets", icon: Ticket },
        ],
      },
      {
        label: "Me",
        items: [
          { to: "/attendance/me", label: "My Attendance", icon: CalendarCheck },
          { to: "/payroll/me", label: "My Payslips", icon: Receipt },
        ],
      },
    ])
  }

  return keep([
    // Site Admin / Project Manager: their site workspace first, then the
    // same self-service pages as any employee.
    ...(role === "SITE_ADMIN"
      ? [{ label: "Sites", items: [{ to: "/site-attendance", label: "Site Attendance", icon: HardHat }] }]
      : []),
    {
      label: "Overview",
      items: [
        { to: `/employees/${user?.id}`, label: "My Profile", icon: UserRound },
        { to: "/calendar", label: "Company Calendar", icon: CalendarRange },
        { to: "/announcements", label: "Announcements", icon: Megaphone },
      ],
    },
    {
      label: "Work",
      items: [
        { to: "/projects", label: "My Projects & Tasks", icon: FolderKanban },
        { to: "/performance", label: "My Performance", icon: Award },
        { to: "/tickets", label: "Tickets", icon: Ticket },
      ],
    },
    {
      label: "Me",
      items: [
        { to: "/attendance/me", label: "My Attendance", icon: CalendarCheck },
        { to: "/payroll/me", label: "My Payslips", icon: Receipt },
      ],
    },
  ])
}
