import { Suspense, lazy, useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { useAuth } from "./context/AuthContext"
import { ThemeProvider, useTheme } from "./context/ThemeContext"
import { isManagement, hasModuleAccess, canManageInventory, canViewEmployeeDirectory, canAccessPayroll } from "./utils/roles"
import DashboardLayout from "./layouts/DashboardLayout"
// Not lazy-loaded like the other pages below: this is the offline-first
// check-in/check-out page, so its code must already be in the main bundle
// a device downloaded on its last online visit. A lazy chunk is only ever
// cached after being fetched once — a field employee opening this page for
// the first time while offline would otherwise hit a network request that
// can't succeed, crashing with "Failed to fetch dynamically imported
// module" instead of loading the page that's supposed to work offline.
import MyAttendance from "./pages/MyAttendance"
// Same reason: the Site Admin workspace is used at sites with no signal.
import SiteAttendance from "./pages/SiteAttendance"
const Register = lazy(() => import("./pages/Register"))
const Welcome = lazy(() => import("./pages/Welcome"))
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"))
const ResetPassword = lazy(() => import("./pages/ResetPassword"))
const AcceptInvite = lazy(() => import("./pages/AcceptInvite"))

const Dashboard = lazy(() => import("./pages/Dashboard"))
const Employees = lazy(() => import("./pages/Employees"))
const EmployeeProfile = lazy(() => import("./pages/EmployeeProfile"))
const EmployeeAttendanceHistory = lazy(() => import("./pages/EmployeeAttendanceHistory"))
const Inventory = lazy(() => import("./pages/Inventory"))
const AssetProfile = lazy(() => import("./pages/AssetProfile"))
const Assignments = lazy(() => import("./pages/Assignments"))
const AssetRequests = lazy(() => import("./pages/AssetRequests"))
const Departments = lazy(() => import("./pages/Departments"))
const Performance = lazy(() => import("./pages/Performance"))
const AdvancedCalendar = lazy(() => import("./pages/AdvancedCalendar"))
const OrganizationComparison = lazy(() => import("./pages/OrganizationComparison"))
const Attendance = lazy(() => import("./pages/Attendance"))
const AttendanceSites = lazy(() => import("./pages/AttendanceSites"))
const LeaveRequests = lazy(() => import("./pages/LeaveRequests"))
const LeaveCalendar = lazy(() => import("./pages/LeaveCalendar"))
const AuditLog = lazy(() => import("./pages/AuditLog"))
const Tickets = lazy(() => import("./pages/Tickets"))
const Settings = lazy(() => import("./pages/Settings"))
const AttendanceDevices = lazy(() => import("./pages/AttendanceDevices"))
const Billing = lazy(() => import("./pages/Billing"))
const Payroll = lazy(() => import("./pages/Payroll"))
const MyPayroll = lazy(() => import("./pages/MyPayroll"))
const ExpenseClaims = lazy(() => import("./pages/ExpenseClaims"))
const Profile = lazy(() => import("./pages/Profile"))
const Notifications = lazy(() => import("./pages/Notifications"))
const Projects = lazy(() => import("./pages/Projects"))
const Announcements = lazy(() => import("./pages/Announcements"))
const EmployeeForms = lazy(() => import("./pages/EmployeeForms"))
const PublicEmployeeForm = lazy(() => import("./pages/PublicEmployeeForm"))
const PayrollReports = lazy(() => import("./pages/PayrollReports"))
const HrReports = lazy(() => import("./pages/HrReports"))

function PageFallback() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="flex items-center gap-3 rounded-full bg-surface px-4 py-2 shadow-card">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        <span className="text-sm text-muted">Loading…</span>
      </div>
    </div>
  )
}

// Generic per-module gate — the frontend counterpart to hasModuleAccess()
// used by the backend's requireModule() middleware. ADMIN/CEO always pass
// via the "*" wildcard in ROLE_MODULES; every other role is checked
// against its own fixed module list.
function RequireModule({ moduleKey, children }) {
  const { user } = useAuth()
  if (!hasModuleAccess(user?.role, moduleKey)) return <Navigate to={user?.id ? `/employees/${user.id}` : "/"} replace />
  return children
}

// Gate for ADMIN/CEO-only pages — org-wide configuration and sensitive
// records that aren't a per-role module in the permission tree (Settings,
// org comparison, the audit log).
function RequireOwner({ children }) {
  const { user } = useAuth()
  if (!["ADMIN", "CEO"].includes(user?.role)) return <Navigate to="/" replace />
  return children
}

function RequireInventoryAccess({ children }) {
  const { user } = useAuth()
  if (!canManageInventory(user?.role)) return <Navigate to={user?.id ? `/employees/${user.id}` : "/"} replace />
  return children
}

function RequireEmployeeDirectory({ children }) {
  const { user } = useAuth()
  if (!canViewEmployeeDirectory(user?.role)) return <Navigate to={user?.id ? `/employees/${user.id}` : "/"} replace />
  return children
}

function RequirePayrollAccess({ children }) {
  const { user } = useAuth()
  if (!canAccessPayroll(user?.role)) return <Navigate to={user?.id ? `/employees/${user.id}` : "/"} replace />
  return children
}

function ProtectedShell() {
  const { user, organization, loading } = useAuth()
  const { applyAccent } = useTheme()

  useEffect(() => {
    if (organization?.primaryColor) applyAccent(organization.primaryColor)
  }, [organization?.primaryColor, applyAccent])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <div className="flex items-center gap-3 rounded-full bg-surface px-4 py-2 shadow-card">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          <span className="text-sm text-muted">Loading…</span>
        </div>
      </div>
    )
  }
  if (!user) return <Navigate to="/" replace />

  const isManager = isManagement(user.role)
  const isIT = user.role === "IT_MANAGER"
  // A Site Admin lands on their site workspace instead of their profile.
  const home = user.role === "SITE_ADMIN" ? "/site-attendance" : `/employees/${user.id}`

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route index element={isManager || isIT ? <Dashboard /> : <Navigate to={home} replace />} />
          <Route path="/dashboard" element={isManager || isIT ? <Dashboard /> : <Navigate to={`/employees/${user.id}`} replace />} />
          <Route path="/employees" element={<RequireEmployeeDirectory><Employees /></RequireEmployeeDirectory>} />
          <Route path="/employees/:id" element={<EmployeeProfile />} />
          <Route path="/employees/:id/attendance" element={<EmployeeAttendanceHistory />} />
          <Route path="/inventory" element={<RequireInventoryAccess><Inventory /></RequireInventoryAccess>} />
          <Route path="/inventory/:id" element={<RequireInventoryAccess><AssetProfile /></RequireInventoryAccess>} />
          <Route path="/assignments" element={<RequireInventoryAccess><Assignments /></RequireInventoryAccess>} />
          <Route path="/projects" element={isIT ? <Navigate to="/inventory" replace /> : <Projects />} />
          <Route path="/asset-requests" element={<RequireInventoryAccess><AssetRequests /></RequireInventoryAccess>} />
          <Route path="/departments" element={<RequireModule moduleKey="departments"><Departments /></RequireModule>} />
          <Route path="/calendar" element={<AdvancedCalendar />} />
          {/* Tasks are a tab of the Projects page; old links/notifications land there. */}
          <Route path="/tasks" element={<Navigate to="/projects?tab=tasks" replace />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/organization-comparison" element={<RequireOwner><OrganizationComparison /></RequireOwner>} />
          <Route path="/attendance" element={<RequireModule moduleKey="attendance"><Attendance /></RequireModule>} />
          <Route path="/attendance/sites" element={<RequireModule moduleKey="attendance"><AttendanceSites /></RequireModule>} />
          <Route path="/attendance/me" element={<MyAttendance />} />
          <Route path="/site-attendance" element={user.role === "SITE_ADMIN" ? <SiteAttendance /> : <Navigate to={isManager ? "/attendance/sites" : home} replace />} />
          <Route path="/leave-requests" element={<RequireModule moduleKey="leave"><LeaveRequests /></RequireModule>} />
          <Route path="/leave-calendar" element={<Navigate to="/calendar" replace />} />
          {/* Holidays live on the Announcements page now. */}
          <Route path="/holidays" element={<Navigate to="/announcements?tab=holidays" replace />} />
          <Route path="/audit-log" element={<RequireOwner><AuditLog /></RequireOwner>} />
          <Route path="/payroll" element={<RequirePayrollAccess><Payroll /></RequirePayrollAccess>} />
          {/* Own payslips — every employee, like GET /payroll/me itself. */}
          <Route path="/payroll/me" element={<MyPayroll />} />
          <Route path="/expense-claims" element={<RequireModule moduleKey="expenseClaims"><ExpenseClaims /></RequireModule>} />
          <Route path="/payroll/reports" element={<RequireModule moduleKey="payrollReports"><PayrollReports /></RequireModule>} />
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/reports" element={<Navigate to="/inventory" replace />} />
          <Route path="/reports/hr" element={<RequireModule moduleKey="hrReports"><HrReports /></RequireModule>} />
          {/* Export page removed — each page has its own export now. */}
          <Route path="/export" element={<Navigate to="/" replace />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/announcements" element={<Announcements />} />
          <Route path="/employee-forms" element={<RequireModule moduleKey="employeeForms"><EmployeeForms /></RequireModule>} />
          <Route path="/settings" element={<RequireOwner><Settings /></RequireOwner>} />
          <Route path="/settings/attendance-devices" element={<RequireOwner><AttendanceDevices /></RequireOwner>} />
          <Route path="/billing" element={<Navigate to="/" replace />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Welcome />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/employee-form/:token" element={<PublicEmployeeForm />} />
            <Route path="/*" element={<ProtectedShell />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
  )
}
