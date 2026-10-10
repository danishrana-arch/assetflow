import { useEffect, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Check, Eye, EyeOff } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import AuthCard, { AuthMessage } from "../components/AuthCard"
import { TextField } from "../components/ui/Field"

// Opened from the invitation email (Employee Forms → Invite new employee).
// Shows who invited them and as what, lets them choose a password, then
// signs them in and opens their profile.
export default function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get("token") || ""
  const navigate = useNavigate()
  const { startSession } = useAuth()
  const [invite, setInvite] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!token) return
    let cancelled = false
    api.get(`/auth/invitation/${encodeURIComponent(token)}`)
      .then(({ data }) => {
        if (cancelled) return
        setInvite(data)
        setName(data.name || "")
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError({
          message: err.response?.data?.error || "Could not open this invitation. Check your connection and try again.",
          accepted: !!err.response?.data?.accepted,
        })
      })
    return () => { cancelled = true }
  }, [token])

  const checks = [
    { ok: password.length >= 8, label: "At least 8 characters" },
    { ok: !!password && password === confirm, label: "Passwords match" },
  ]
  const ready = checks.every((c) => c.ok) && name.trim()

  async function handleSubmit(e) {
    e.preventDefault()
    if (!ready) return
    setError("")
    setSaving(true)
    try {
      const { data } = await api.post("/auth/accept-invitation", { token, password, name: name.trim() })
      startSession(data)
      navigate("/profile", { replace: true })
    } catch (err) {
      setError(err.response?.data?.error || "Could not accept the invitation. Please try again.")
      setSaving(false)
    }
  }

  if (!token) {
    return (
      <AuthCard title="Invitation link missing" subtitle="Open the link from your invitation email, or ask HR to send it again." />
    )
  }

  if (loadError) {
    return (
      <AuthCard title={loadError.accepted ? "Already accepted" : "Invitation unavailable"}>
        <AuthMessage tone={loadError.accepted ? "info" : "error"}>{loadError.message}</AuthMessage>
        {loadError.accepted && (
          <Link to="/login" className="pill-accent mt-4 block w-full py-3 text-center text-sm font-semibold">Sign in</Link>
        )}
      </AuthCard>
    )
  }

  if (!invite) {
    return (
      <AuthCard title="Opening your invitation…">
        <p className="text-sm text-muted">Just a moment.</p>
      </AuthCard>
    )
  }

  const details = [
    ["Company", invite.organizationName],
    ["Role", invite.roleLabel],
    invite.designation && ["Designation", invite.designation],
    invite.department && ["Department", invite.department],
    ["Sign-in email", invite.email],
  ].filter(Boolean)

  return (
    <AuthCard
      brandName={invite.organizationName}
      title={`Join ${invite.organizationName}`}
      subtitle={`${invite.organizationName} has invited you to join the team. Choose a password to finish setting up your account.`}
    >
      <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-2xl border border-border bg-surface-2 p-4 text-sm">
        {details.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 break-words font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {invite.message && (
        <p className="mb-5 whitespace-pre-line rounded-2xl bg-surface-2 p-4 text-sm italic text-ink">
          “{invite.message}”
          <span className="mt-1 block text-xs not-italic text-muted">— {invite.organizationName}</span>
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField label="Your name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" />
        <div>
          <TextField
            label="Password"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
          <button type="button" onClick={() => setShow((v) => !v)} className="mt-1 flex items-center gap-1 text-xs font-semibold text-accent">
            {show ? <EyeOff size={12} /> : <Eye size={12} />} {show ? "Hide" : "Show"} password
          </button>
        </div>
        <TextField
          label="Confirm password"
          type={show ? "text" : "password"}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <ul className="space-y-1">
          {checks.map((c) => (
            <li key={c.label} className={`flex items-center gap-1.5 text-xs ${c.ok ? "text-success" : "text-muted"}`}>
              <Check size={12} className={c.ok ? "" : "opacity-30"} /> {c.label}
            </li>
          ))}
        </ul>
        {error && <AuthMessage tone="error">{error}</AuthMessage>}
        <button type="submit" disabled={!ready || saving} className="pill-accent w-full py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60">
          {saving ? "Setting up your account…" : "Accept & go to my profile"}
        </button>
      </form>
    </AuthCard>
  )
}
