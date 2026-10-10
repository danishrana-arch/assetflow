import { useState } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import useLandingFonts from "../hooks/useLandingFonts"
import logoFull from "../assets/logo1.png"

/* Sign-in page, styled to match the public landing page. */

const MAX_FAILS = 4

const POINTS = [
  { icon: "groups", text: "People, attendance and projects in one workspace" },
  { icon: "pin_drop", text: "Location-verified check-ins, online or offline" },
  { icon: "account_balance_wallet", text: "Payroll calculated from verified data" },
]

function Icon({ name, className = "" }) {
  return <span aria-hidden="true" className={`material-symbols-outlined select-none ${className}`}>{name}</span>
}

export default function Login() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [fails, setFails] = useState(0)
  useLandingFonts()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-margin-mobile font-body-md">
        <div className="flex items-center gap-space-sm rounded-full bg-surface-container-lowest px-space-lg py-space-sm text-body-md text-on-surface-variant shadow-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          Preparing your workspace…
        </div>
      </div>
    )
  }
  if (user) return <Navigate to="/dashboard" replace />

  async function submit(e) {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      await login(email, password)
      navigate("/")
    } catch (err) {
      setError(err.response?.data?.error || "Login failed")
      const status = err.response?.status
      if (status === 401) setFails((n) => n + 1)
      if (status === 429) setFails(MAX_FAILS)
    } finally {
      setBusy(false)
    }
  }

  const forgotHref = `/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`
  const input =
    "w-full rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-space-md py-space-md font-body-md text-body-md text-on-surface outline-none transition placeholder:text-outline focus:border-primary-container focus:ring-[3px] focus:ring-primary-container/20"

  return (
    <div className="grid min-h-screen grid-cols-1 bg-background font-body-md text-body-md text-on-surface antialiased lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-b from-[#120e3a] via-[#1a1854] to-[#2a1f7a] p-space-2xl text-on-primary lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -top-32 left-1/2 h-[540px] w-[700px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-primary-container via-secondary to-tertiary-fixed opacity-30 blur-[130px]" />
        <div className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-tertiary-fixed-dim opacity-20 blur-[110px]" />
        <Link to="/" className="relative flex items-center gap-space-sm">
          <img src={logoFull} alt="ManagementDock" className="h-10 w-10 rounded-xl object-contain" />
          <span className="font-headline-sm text-headline-sm font-extrabold tracking-tight">Management<span className="text-primary-fixed-dim">Dock</span></span>
        </Link>
        <div className="relative max-w-md">
          <h2 className="font-headline-lg text-headline-lg font-extrabold tracking-tight">
            Welcome back to your{" "}
            <span className="bg-gradient-to-r from-primary-fixed via-tertiary-fixed to-secondary-fixed bg-clip-text text-transparent">workspace.</span>
          </h2>
          <ul className="mt-space-xl space-y-space-md">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-center gap-space-md rounded-xl bg-surface-container-lowest/10 p-space-md backdrop-blur-md">
                <Icon name={p.icon} className="text-tertiary-fixed text-[24px]" />
                <span className="font-body-md text-body-md text-secondary-fixed">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative font-body-sm text-body-sm text-secondary-fixed/70">© {new Date().getFullYear()} ManagementDock</p>
      </aside>

      {/* Form */}
      <main className="flex items-center justify-center px-margin-mobile py-space-2xl md:px-margin-tablet">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-space-xl flex items-center gap-space-sm lg:hidden">
            <img src={logoFull} alt="ManagementDock" className="h-10 w-10 rounded-xl object-contain" />
            <span className="font-headline-sm text-headline-sm font-extrabold tracking-tight">Management<span className="text-primary">Dock</span></span>
          </Link>

          <h1 className="font-headline-lg-mobile text-headline-lg-mobile font-extrabold tracking-tight md:font-headline-lg md:text-headline-lg">Sign in</h1>
          <p className="mt-space-xs font-body-lg text-body-lg text-on-surface-variant">Secure sign-in for your organization.</p>

          <form onSubmit={submit} className="mt-space-xl space-y-space-md">
            <label className="block">
              <span className="mb-space-xs block font-label-caps text-label-caps uppercase text-on-surface-variant">Email</span>
              <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setFails(0) }} placeholder="you@company.com" autoComplete="email" required autoFocus className={input} />
            </label>
            <label className="block">
              <span className="mb-space-xs block font-label-caps text-label-caps uppercase text-on-surface-variant">Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required className={input} />
            </label>

            <div className="text-right">
              <Link to={forgotHref} className="font-label-md text-label-md text-primary hover:underline">Forgot password?</Link>
            </div>

            {fails >= MAX_FAILS ? (
              <div role="alert" className="rounded-xl bg-error-container px-space-md py-space-sm font-body-sm text-body-sm text-on-error-container">
                <p className="font-bold">Too many failed attempts</p>
                <p>The account owner is notified about repeated failed sign-ins. If this is your account, reset your password instead of guessing.</p>
                <Link to={forgotHref} className="mt-space-sm inline-block rounded-full bg-error px-space-md py-space-xs font-bold text-on-error hover:opacity-90">Reset my password</Link>
              </div>
            ) : (
              error && <div role="alert" className="rounded-xl bg-error-container px-space-md py-space-sm font-body-sm text-body-sm text-on-error-container">{error}</div>
            )}

            <button type="submit" disabled={busy} className="w-full rounded-xl bg-gradient-to-r from-primary via-primary-container to-secondary py-space-md font-label-lg text-label-lg font-bold text-on-primary shadow-[0_8px_24px_-2px_rgba(121,87,255,0.4)] transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-space-lg text-center text-on-surface-variant">
            New to ManagementDock?{" "}
            <Link to="/register" className="font-bold text-primary hover:underline">Create a workspace</Link>
          </p>
          <p className="mt-space-md text-center">
            <Link to="/" className="font-label-md text-label-md text-on-surface-variant hover:text-primary">← Back to home</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
