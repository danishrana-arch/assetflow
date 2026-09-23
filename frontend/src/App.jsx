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
const Login = lazy(() => import("./pages/Login"))
const Register = lazy(() => import("./pages/Register"))
const Welcome = lazy(() => import("./pages/Welcome"))

const Dashboard = lazy(() => import("./pages/Dashboard"))
const Employees = lazy(() => import("./pages/Employees"))
const EmployeeProfile = lazy(() => import("./pages/EmployeeProfile"))
const EmployeeAttendanceHistory = lazy(() => import("./pages/EmployeeAttendanceHistory"))
const Inventory = lazy(() => import("./pages/Inventory"))
const AssetProfile = lazy(() => import("./pages/AssetProfile"))
const Assignments = lazy(() => import("./pages/Assignments"))
const AssetRequests = lazy(() => import("./pages/AssetRequests"))
const Departments = lazy(() => import("./pages/Departments"))
const Tasks = lazy(() => import("./pages/Tasks"))
const Performance = lazy(() => import("./pages/Performance"))
const AdvancedCalendar = lazy(() => import("./pages/AdvancedCalendar"))
const OrganizationComparison = lazy(() => import("./pages/OrganizationComparison"))
const Employee360 = lazy(() => import("./pages/Employee360"))
const Attendance = lazy(() => import("./pages/Attendance"))
const AttendanceSites = lazy(() => import("./pages/AttendanceSites"))
const LeaveRequests = lazy(() => import("./pages/LeaveRequests"))
const LeaveCalendar = lazy(() => import("./pages/LeaveCalendar"))
const Holidays = lazy(() => import("./pages/Holidays"))
const AuditLog = lazy(() => import("./pages/AuditLog"))
const Tickets = lazy(() => import("./pages/Tickets"))
const Reports = lazy(() => import("./pages/Reports"))
const Export = lazy(() => import("./pages/Export"))
const Settings = lazy(() => import("./pages/Settings"))
const AttendanceDevices = lazy(() => import("./pages/AttendanceDevices"))
const Billing = lazy(() => import("./pages/Billing"))
const Payroll = lazy(() => import("./pages/Payroll"))
const MyPayroll = lazy(() => import("./pages/MyPayroll"))
const Profile = lazy(() => import("./pages/Profile"))
const Notifications = lazy(() => import("./pages/Notifications"))
const Projects = lazy(() => import("./pages/Projects"))
const Announcements = lazy(() => import("./pages/Announcements"))
const EmployeeForms = lazy(() => import("./pages/EmployeeForms"))
const PublicEmployeeForm = lazy(() => import("./pages/PublicEmployeeForm"))
const Sales = lazy(() => import("./pages/Sales"))
const SalesTeam = lazy(() => import("./pages/SalesTeam"))
const SalesReports = lazy(() => import("./pages/SalesReports"))
const HrReports = lazy(() => import("./pages/HrReports"))
const FinancialReports = lazy(() => import("./pages/FinancialReports"))
const PayrollReports = lazy(() => import("./pages/PayrollReports"))

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
  if (!hasModuleAccess(user?.role, moduleKey)) return <Navigate to={user?.id ? `/employees/${user.id}` : "/login"} replace />
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
  if (!canManageInventory(user?.role)) return <Navigate to={user?.id ? `/employees/${user.id}` : "/login"} replace />
  return children
}

function RequireEmployeeDirectory({ children }) {
  const { user } = useAuth()
  if (!canViewEmployeeDirectory(user?.role)) return <Navigate to={user?.id ? `/employees/${user.id}` : "/login"} replace />
  return children
}

function RequirePayrollAccess({ children }) {
  const { user } = useAuth()
  if (!canAccessPayroll(user?.role)) return <Navigate to={user?.id ? `/employees/${user.id}` : "/login"} replace />
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
  if (!user) return <Navigate to="/login" replace />

  const isManager = isManagement(user.role)
  const isIT = user.role === "IT_MANAGER"

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route index element={isManager || isIT ? <Dashboard /> : <Navigate to={`/employees/${user.id}`} replace />} />
          <Route path="/dashboard" element={isManager || isIT ? <Dashboard /> : <Navigate to={`/employees/${user.id}`} replace />} />
          <Route path="/employees" element={<RequireEmployeeDirectory><Employees /></RequireEmployeeDirectory>} />
          <Route path="/employees/:id" element={<EmployeeProfile />} />
          <Route path="/employees/:id/attendance" element={<EmployeeAttendanceHistory />} />
          <Route path="/employee-360/:id" element={<Employee360 />} />
          <Route path="/inventory" element={<RequireInventoryAccess><Inventory /></RequireInventoryAccess>} />
          <Route path="/inventory/:id" element={<RequireInventoryAccess><AssetProfile /></RequireInventoryAccess>} />
          <Route path="/assignments" element={<RequireInventoryAccess><Assignments /></RequireInventoryAccess>} />
          <Route path="/projects" element={isIT ? <Navigate to="/inventory" replace /> : <Projects />} />
          <Route path="/asset-requests" element={<RequireInventoryAccess><AssetRequests /></RequireInventoryAccess>} />
          <Route path="/departments" element={<RequireModule moduleKey="departments"><Departments /></RequireModule>} />
          <Route path="/calendar" element={<AdvancedCalendar />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/organization-comparison" element={<RequireOwner><OrganizationComparison /></RequireOwner>} />
          <Route path="/attendance" element={<RequireModule moduleKey="attendance"><Attendance /></RequireModule>} />
          <Route path="/attendance/sites" element={<RequireModule moduleKey="attendance"><AttendanceSites /></RequireModule>} />
          <Route path="/attendance/me" element={<MyAttendance />} />
          <Route path="/leave-requests" element={<RequireModule moduleKey="leave"><LeaveRequests /></RequireModule>} />
          <Route path="/leave-calendar" element={<Navigate to="/calendar" replace />} />
          <Route path="/holidays" element={<RequireModule moduleKey="leave"><Holidays /></RequireModule>} />
          <Route path="/audit-log" element={<RequireOwner><AuditLog /></RequireOwner>} />
          <Route path="/payroll" element={<RequirePayrollAccess><Payroll /></RequirePayrollAccess>} />
          <Route path="/payroll/me" element={<RequirePayrollAccess><MyPayroll /></RequirePayrollAccess>} />
          <Route path="/payroll/reports" element={<RequireModule moduleKey="payrollReports"><PayrollReports /></RequireModule>} />
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/reports" element={<RequireModule moduleKey="reports"><Reports /></RequireModule>} />
          <Route path="/reports/sales" element={<RequireModule moduleKey="salesReports"><SalesReports /></RequireModule>} />
          <Route path="/reports/hr" element={<RequireModule moduleKey="hrReports"><HrReports /></RequireModule>} />
          <Route path="/reports/financial" element={<RequireModule moduleKey="financialReports"><FinancialReports /></RequireModule>} />
          <Route path="/sales" element={<RequireModule moduleKey="sales"><Sales /></RequireModule>} />
          <Route path="/sales-team" element={<RequireModule moduleKey="salesTeam"><SalesTeam /></RequireModule>} />
          <Route path="/export" element={<RequireModule moduleKey="reports"><Export /></RequireModule>} />
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
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/employee-form/:token" element={<PublicEmployeeForm />} />
            <Route path="/*" element={<ProtectedShell />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
  )
}
