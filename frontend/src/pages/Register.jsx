import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import api from "../api/client"
import logoFull from "../assets/logo1.png"


export default function Register() {
  const navigate = useNavigate()
  const { login } = useAuth()

  const [organizationName, setOrganizationName] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError("")

    if (password !== confirmPassword) {
      setError("Passwords don't match")
      return
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }

    setLoading(true)
    try {
      // NOTE: field names here (organizationName/name/email/password) match
      // the common shape for this kind of endpoint — double check these
      // against your actual `registerOrganization` controller in
      // auth.controller.js and adjust if it expects different keys.
      const res = await api.post("/auth/register", { organizationName, name, email, password })

      // The API returns a token for the new owner, so establish the session
      // immediately and send the user into the application.
      if (res.data?.token) {
        localStorage.setItem("assetflow_token", res.data.token)
        await login(email, password)
        navigate("/dashboard")
      } else {
        navigate("/login")
      }
    } catch (err) {
      setError(err.response?.data?.error || "Could not create your account")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-[28px] bg-surface shadow-card-lg lg:grid-cols-2">
        {/* Left visual — mirrors Login.jsx */}
        <div className="relative hidden flex-col justify-between bg-gradient-to-br from-chip-blue-bg via-chip-purple-bg to-chip-cyan-bg p-10 lg:flex">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold text-white"
              style={{ backgroundColor: "var(--accent)" }}
            >
              A
            </div>
            <span className="text-lg font-semibold text-ink">AssetFlow</span>
          </div>

          <div className="space-y-6">
            <h2 className="text-3xl font-semibold text-ink" style={{ letterSpacing: "-0.02em" }}>
              Set up your organization
            </h2>
            <p className="max-w-sm text-sm text-muted">
              Track inventory, manage your team, run attendance and payroll all in one place.
              This creates your organization and your owner account together.
            </p>
          </div>

          <p className="text-xs text-muted-2">© {new Date().getFullYear()} AssetFlow</p>
        </div>

        {/* Right — form */}
        <div className="flex flex-col justify-center p-8 sm:p-12">
          <h1 className="text-2xl font-semibold text-ink" style={{ letterSpacing: "-0.02em" }}>
            Create your account
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Already have one?{" "}
            <Link to="/login" className="font-medium text-accent hover:underline">
              Log in instead
            </Link>
          </p>
          <Link to="/" className="mt-2 inline-block text-xs font-medium text-muted hover:text-accent">
            ← Back to welcome
          </Link>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
                Organization name
              </label>
              <input
                className="field"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="Acme Inc."
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
                Your full name
              </label>
              <input
                className="field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
                Email
              </label>
              <input
                type="email"
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
                  Password
                </label>
                <input
                  type="password"
                  className="field"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
                  Confirm password
                </label>
                <input
                  type="password"
                  className="field"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="pill-accent w-full py-3 text-sm disabled:opacity-60">
              {loading ? "Creating your organization…" : "Create account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
