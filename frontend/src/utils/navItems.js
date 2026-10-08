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
  Bell,
  ListTodo,
  Fingerprint,
  CreditCard,
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

// Extra words each page can be found by in the global search bar.
const PAGE_KEYWORDS = {
  "/": "home overview stats",
  "/calendar": "events birthdays leave calendar schedule",
  "/announcements": "news notices posts holidays",
  "/employees": "staff people directory team members add employee import",
  "/departments": "teams units",
  "/employee-forms": "invite invitation onboarding form new hire",
  "/attendance": "daily check in out present absent late fines policy report",
  "/attendance/sites": "geofence location office site map",
  "/leave-requests": "leave time off vacation approve",
  "/attendance/me": "check in check out clock correction",
  "/projects": "tasks todo work",
  "/performance": "reviews ratings appraisal bonus",
  "/tickets": "support help requests issues",
  "/inventory": "assets equipment laptops devices stock",
  "/assignments": "assigned assets",
  "/asset-requests": "equipment request",
  "/payroll": "salary pay payslips generate tax termination",
  "/payroll/reports": "salary summary trend",
  "/payroll/me": "salary pay slip expenses claims",
  "/reports/hr": "reports headcount export generate",
  "/organization-comparison": "companies compare",
  "/audit-log": "history activity log security",
  "/settings": "configuration company theme timezone working hours shift",
  "/site-attendance": "site workers mark",
  "/profile": "account password change photo",
  "/notifications": "alerts activity bell",
  "/expense-claims": "expenses reimbursement claims",
  "/settings/attendance-devices": "biometric fingerprint machine zkteco",
}

// Every page this user can open, for the global search bar: the nav list
// above plus pages that are reached from elsewhere (same gates as App.jsx).
export function searchablePages(user) {
  const role = user?.role
  const isOwner = ["ADMIN", "CEO"].includes(role)
  const pages = navGroups(user).flatMap((g) => g.items.map((item) => ({ ...item, group: g.label })))
  const extras = [
    { to: "/profile", label: "My Account", icon: UserRound, group: "Me" },
    { to: "/notifications", label: "Notifications", icon: Bell, group: "Me" },
    { to: "/announcements?tab=holidays", label: "Holidays", icon: CalendarDays, group: "Overview", keywords: "public holidays off days add holiday" },
    { to: `/employees/${user?.id}`, label: "My Profile", icon: UserRound, group: "Me", show: !!user?.id },
    { to: "/projects?tab=tasks", label: isManagement(role) ? "Tasks" : "My Tasks", icon: ListTodo, group: "Work", show: role !== "IT_MANAGER" && (!isManagement(role) || hasModuleAccess(role, "projects")) },
    { to: "/expense-claims", label: "Expense Claims", icon: Receipt, group: "Payroll", show: hasModuleAccess(role, "expenseClaims") },
    { to: "/settings/attendance-devices", label: "Attendance Devices", icon: Fingerprint, group: "Reports & Admin", show: isOwner },
    { to: "/billing", label: "Billing & Subscription", icon: CreditCard, group: "Reports & Admin", show: isOwner, keywords: "plan plans pricing upgrade subscription invoice payment employee limit sale" },
  ].filter((p) => p.show !== false)
  const seen = new Set()
  return [...pages, ...extras]
    .filter((p) => (seen.has(p.to) ? false : seen.add(p.to)))
    .map((p) => ({ ...p, keywords: p.keywords || PAGE_KEYWORDS[p.to.split("?")[0]] || (p.to.startsWith("/employees/") ? "profile me details documents" : "") }))
}

// Pages matching a search query, best first (all words must match).
export function matchPages(pages, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return pages
    .map((page) => {
      const label = page.label.toLowerCase()
      const haystack = `${label} ${page.group || ""} ${page.keywords}`.toLowerCase()
      if (!words.every((w) => haystack.includes(w))) return null
      const q = words.join(" ")
      const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : words.every((w) => label.includes(w)) ? 2 : 3
      return { page, score }
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.page.label.localeCompare(b.page.label))
    .map((r) => r.page)
}
