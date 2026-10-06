import { Link } from "react-router-dom"
import { useTheme } from "../context/ThemeContext"
import logoFull from "../assets/logo1.png"

// Minimal centered card for the public auth pages (forgot/reset password),
// matching the Login page's light/dark palette.
// `brandName` swaps the app logo for a company name (invitation page).
export default function AuthCard({ title, subtitle, brandName, children }) {
  const { mode } = useTheme()
  const isDark = mode === "dark"

  return (
    <div className={`flex min-h-screen items-center justify-center p-4 transition-colors duration-300 ${isDark ? "bg-[#0d1110]" : "bg-[#f4f6f5]"}`}>
      <div
        className={`w-full max-w-md rounded-[28px] p-8 shadow-xl ${isDark ? "bg-[#151a19] border border-white/5" : "bg-white"}`}
      >
        {brandName ? (
          <div className="mb-6 flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-base font-bold text-on-accent">
              {brandName.trim().charAt(0).toUpperCase()}
            </span>
            <span className={`min-w-0 truncate text-base font-bold tracking-tight ${isDark ? "text-white" : "text-[#202525]"}`}>{brandName}</span>
          </div>
        ) : (
          <Link to="/login" className="mb-6 flex items-center gap-2.5">
            <img src={logoFull} alt="ManagementDock" className="h-9 w-9 rounded-xl object-contain" />
            <span className={`text-base font-bold tracking-tight ${isDark ? "text-white" : "text-[#202525]"}`}>ManagementDock</span>
          </Link>
        )}
        <h1 className={`text-2xl font-semibold ${isDark ? "text-white" : "text-[#202525]"}`} style={{ letterSpacing: "-0.02em" }}>
          {title}
        </h1>
        {subtitle && <p className={`mt-1 text-sm ${isDark ? "text-white/55" : "text-[#687272]"}`}>{subtitle}</p>}
        <div className="mt-6">{children}</div>
        <p className={`mt-6 text-center text-sm ${isDark ? "text-white/60" : "text-[#687272]"}`}>
          <Link to="/login" className="font-semibold text-accent hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}

export function AuthMessage({ tone = "info", children }) {
  const { mode } = useTheme()
  const isDark = mode === "dark"
  const styles = {
    info: isDark ? "bg-emerald-500/10 text-emerald-200 border border-emerald-400/15" : "bg-emerald-50 text-emerald-900 border border-emerald-200",
    error: isDark ? "bg-red-500/10 text-red-300 border border-red-400/10" : "bg-chip-pink-bg text-chip-pink-fg",
  }
  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-2xl px-3.5 py-2.5 text-sm ${styles[tone]}`}>{children}</div>
}
