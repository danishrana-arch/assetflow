import { useState } from "react"
import { Outlet } from "react-router-dom"
import { KeyRound, LogOut, ShieldCheck } from "lucide-react"
import { useAuth } from "../context/AuthContext"
import ThemeToggle from "../components/ThemeToggle"
import ChangePasswordDialog from "../components/control/ChangePasswordDialog"

// The platform account's whole app: a plain top bar and the Control Center.
// No company sidebar, dashboards, search, notifications or organization
// switcher — this account belongs to no company.
export default function PlatformLayout() {
  const { user, logout } = useAuth()
  const [changingPassword, setChangingPassword] = useState(false)
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6">
          <ShieldCheck size={20} className="text-ink" />
          <span className="text-sm font-semibold text-ink">ManagementDock Platform</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">{user?.email}</span>
            <ThemeToggle />
            <button type="button" onClick={() => setChangingPassword(true)} className="pill-secondary inline-flex items-center gap-2 px-4 py-2 text-sm">
              <KeyRound size={14} /> <span className="hidden sm:inline">Change password</span>
            </button>
            <button type="button" onClick={logout} className="pill-secondary inline-flex items-center gap-2 px-4 py-2 text-sm">
              <LogOut size={14} /> Log out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <Outlet />
      </main>
      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
    </div>
  )
}
