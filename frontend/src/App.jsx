import { Suspense, lazy, useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { useAuth } from "./context/AuthContext"
import { ThemeProvider, useTheme } from "./context/ThemeContext"
import { isManagement } from "./utils/roles"
import DashboardLayout from "./layouts/DashboardLayout"
import Login from "./pages/Login"

const Dashboard = lazy(() => import("./pages/Dashboard"))
const Employees = lazy(() => import("./pages/Employees"))
const EmployeeProfile = lazy(() => import("./pages/EmployeeProfile"))
const Inventory = lazy(() => import("./pages/Inventory"))
const AssetProfile = lazy(() => import("./pages/AssetProfile"))
const Assignments = lazy(() => import("./pages/Assignments"))
const AssetRequests = lazy(() => import("./pages/AssetRequests"))
const Departments = lazy(() => import("./pages/Departments"))
const Attendance = lazy(() => import("./pages/Attendance"))
const MyAttendance = lazy(() => import("./pages/MyAttendance"))
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

// Gate for management-only pages (Owner + CEO/Sales Head/HR).
function RequireManagement({ children }) {
  const { user } = useAuth()
  if (!isManagement(user?.role)) return <Navigate to={`/employees/${user?.id}`} replace />
  return children
}

function RequireOwner({ children }) {
  const { user } = useAuth()
  if (!["ADMIN", "CEO"].includes(user?.role)) return <Navigate to="/" replace />
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

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route index element={isManager ? <Dashboard /> : <Navigate to={`/employees/${user.id}`} replace />} />
          <Route path="/employees" element={<RequireManagement><Employees /></RequireManagement>} />
          <Route path="/employees/:id" element={<EmployeeProfile />} />
          <Route path="/inventory" element={<RequireManagement><Inventory /></RequireManagement>} />
          <Route path="/inventory/:id" element={<AssetProfile />} />
          <Route path="/assignments" element={<RequireManagement><Assignments /></RequireManagement>} />
          <Route path="/projects" element={<RequireManagement><Projects /></RequireManagement>} />
          <Route path="/asset-requests" element={<RequireManagement><AssetRequests /></RequireManagement>} />
          <Route path="/departments" element={<RequireManagement><Departments /></RequireManagement>} />
          <Route path="/attendance" element={<RequireManagement><Attendance /></RequireManagement>} />
          <Route path="/attendance/me" element={<MyAttendance />} />
          <Route path="/leave-requests" element={<RequireManagement><LeaveRequests /></RequireManagement>} />
          <Route path="/leave-calendar" element={<RequireManagement><LeaveCalendar /></RequireManagement>} />
          <Route path="/holidays" element={<RequireManagement><Holidays /></RequireManagement>} />
          <Route path="/audit-log" element={<RequireManagement><AuditLog /></RequireManagement>} />
          <Route path="/payroll" element={<RequireManagement><Payroll /></RequireManagement>} />
          <Route path="/payroll/me" element={<MyPayroll />} />
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/reports" element={<RequireManagement><Reports /></RequireManagement>} />
          <Route path="/export" element={<RequireManagement><Export /></RequireManagement>} />
          <Route path="/notifications" element={<RequireManagement><Notifications /></RequireManagement>} />
          <Route path="/settings" element={<RequireOwner><Settings /></RequireOwner>} />
          <Route path="/settings/attendance-devices" element={<RequireOwner><AttendanceDevices /></RequireOwner>} />
          <Route path="/billing" element={<RequireManagement><Billing /></RequireManagement>} />
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
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<ProtectedShell />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}
