import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import api from "../api/client"
import AuthCard, { AuthMessage } from "../components/AuthCard"
import { TextField } from "../components/ui/Field"

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get("token") || ""
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState("")
  const [error, setError] = useState("")

  async function handleSubmit(e) {
    e.preventDefault()
    setError("")
    if (password.length < 8) return setError("Password must be at least 8 characters.")
    if (password !== confirm) return setError("Passwords don't match.")
    setLoading(true)
    try {
      const { data } = await api.post("/auth/reset-password", { token, password })
      setDone(data?.message || "Your password has been updated. You can now sign in.")
    } catch (err) {
      setError(err.response?.data?.error || "Could not reset your password. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <AuthCard title="Reset link missing" subtitle="This page needs the link from your password reset email.">
        <Link to="/forgot-password" className="pill-accent block w-full py-3 text-center text-sm font-semibold">Request a new link</Link>
      </AuthCard>
    )
  }

  if (done) {
    return (
      <AuthCard title="Password updated">
        <AuthMessage>{done}</AuthMessage>
        <Link to="/login" className="pill-accent mt-4 block w-full py-3 text-center text-sm font-semibold">Sign in</Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Set a new password" subtitle="Choose a password with at least 8 characters.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        <TextField label="Confirm new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
        {error && (
          <AuthMessage tone="error">
            {error}{" "}
            {/expired|invalid/i.test(error) && <Link to="/forgot-password" className="font-semibold underline">Request a new link</Link>}
          </AuthMessage>
        )}
        <button type="submit" disabled={loading} className="pill-accent w-full py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60">
          {loading ? "Saving…" : "Update password"}
        </button>
      </form>
    </AuthCard>
  )
}
