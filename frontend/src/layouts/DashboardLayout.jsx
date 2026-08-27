import { useState } from "react"
import { Outlet } from "react-router-dom"
import Sidebar from "../components/Sidebar"
import Topbar from "../components/Topbar"
import MobileNav from "../components/MobileNav"
import OrganizationSwitcher from "../components/OrganizationSwitcher"
import { useAuth } from "../context/AuthContext"
import { isManagement } from "../utils/roles"

export default function DashboardLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user } = useAuth()
  const showCompanySwitcher = isManagement(user?.role) && ["ADMIN", "CEO"].includes(user?.role)

  return (
    <div className="min-h-screen overflow-x-hidden bg-canvas">
      <Sidebar />
      <Topbar onMenuClick={() => setMobileOpen(true)} />
      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} />

      {showCompanySwitcher && (
        <div className="pointer-events-none fixed right-5 top-4 z-30 hidden lg:block">
          <div className="pointer-events-auto rounded-2xl border border-border bg-surface/90 p-1.5 shadow-card backdrop-blur-xl">
            <OrganizationSwitcher />
          </div>
        </div>
      )}

      <main className="w-full px-3 py-4 sm:px-5 sm:py-6 md:px-6 lg:pl-[120px] lg:pr-8 lg:pt-7">
        <div className="mx-auto w-full max-w-[1600px] min-w-0">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
