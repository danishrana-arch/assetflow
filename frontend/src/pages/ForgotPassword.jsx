import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import api from "../api/client"
import AuthCard, { AuthMessage } from "../components/AuthCard"
import { TextField } from "../components/ui/Field"

export default function ForgotPassword() {
  const [params] = useSearchParams()
  const [email, setEmail] = useState(params.get("email") || "")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  async function handleSubmit(e) {
    e.preventDefault()
    setError("")
    setMessage("")
    setLoading(true)
    try {
      const { data } = await api.post("/auth/forgot-password", { email: email.trim() })
      setMessage(data?.message || "If an account exists for that email, a password reset link has been sent.")
    } catch (err) {
      setError(err.response?.data?.error || "Could not send the reset link. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard title="Forgot your password?" subtitle="Enter your work email and we'll send you a link to set a new password.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
          autoComplete="email"
        />
        {message && <AuthMessage>{message} Check your inbox (and spam folder). The link is valid for 1 hour.</AuthMessage>}
        {error && <AuthMessage tone="error">{error}</AuthMessage>}
        <button type="submit" disabled={loading} className="pill-accent w-full py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60">
          {loading ? "Sending…" : message ? "Send again" : "Send reset link"}
        </button>
      </form>
    </AuthCard>
  )
}
