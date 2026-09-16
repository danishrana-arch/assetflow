import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react"
import api from "../api/client"

const AuthContext = createContext(null)
const TOKEN_KEY = "assetflow_token"
const ORG_KEY = "assetflow_active_organization"
const USER_CACHE_KEY = "assetflow_user_cache"
const LAST_ACTIVITY_KEY = "assetflow_last_activity"
const INACTIVITY_LIMIT_MS = 60 * 60 * 1000

function readCachedUser() {
  try {
    const value = localStorage.getItem(USER_CACHE_KEY)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function normalizeOrganizations(user, organizations = []) {
  if (organizations.length) return organizations
  if (user?.organization) return [user.organization]
  return []
}

function pickActiveOrganization(user, organizations) {
  const savedId = localStorage.getItem(ORG_KEY)
  const allowed = normalizeOrganizations(user, organizations)
  const saved = allowed.find((org) => org.id === savedId)
  if (saved) return saved
  return allowed.find((org) => org.id === user?.organization?.id) || allowed[0] || user?.organization || null
}

function normalizeAuthPayload(data) {
  if (!data) return { user: null, organization: null, organizations: [] }

  const nestedUser = data.user || null
  const rootUser = nestedUser || {
    id: data.id,
    name: data.name,
    email: data.email,
    role: data.role,
    status: data.status,
    canManageAttendance: data.canManageAttendance,
    organization: data.organization,
  }

  return {
    user: rootUser,
    organization: data.organization || rootUser?.organization || null,
    organizations: data.organizations || normalizeOrganizations(rootUser, []),
  }
}

export function AuthProvider({ children }) {
  const cached = readCachedUser()
  const [user, setUser] = useState(cached?.user || null)
  const [organization, setOrganization] = useState(cached?.organization || cached?.user?.organization || null)
  const [organizations, setOrganizations] = useState(cached?.organizations || normalizeOrganizations(cached?.user, []))
  const [loading, setLoading] = useState(!cached?.user)
  const lastActivityWriteRef = useRef(0)

  const markActivity = useCallback(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return
    const now = Date.now()
    if (now - lastActivityWriteRef.current < 15000) return
    lastActivityWriteRef.current = now
    localStorage.setItem(LAST_ACTIVITY_KEY, String(now))
  }, [])

  const applyAuthData = useCallback((data) => {
    const normalized = normalizeAuthPayload(data)
    const nextUser = normalized.user
    const nextOrganizations = normalizeOrganizations(nextUser, normalized.organizations || [])
    const active = pickActiveOrganization(nextUser, nextOrganizations)
    const nextOrganization = normalized.organization || active || nextUser?.organization || null

    setUser(nextUser)
    setOrganizations(nextOrganizations)
    setOrganization(nextOrganization)

    if (nextOrganization?.id) localStorage.setItem(ORG_KEY, nextOrganization.id)
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify({
      user: nextUser,
      organization: nextOrganization,
      organizations: nextOrganizations,
    }))
  }, [])

  const refreshUser = useCallback(() => {
    return api.get("/auth/me").then((res) => {
      applyAuthData(res.data)
      return res.data
    })
  }, [applyAuthData])

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      setLoading(false)
      return
    }

    // Cached auth data makes reloads feel immediate. /auth/me still runs in
    // the background so role, organization and permission changes are fresh.
    // Only clear the session when the server actually rejects the token
    // (401). A cold-start timeout, dropped connection, or brief 5xx from the
    // backend spinning back up must NOT wipe a still-valid login.
    refreshUser()
      .catch((err) => {
        if (err?.response?.status === 401) {
          localStorage.removeItem(TOKEN_KEY)
          localStorage.removeItem(USER_CACHE_KEY)
          localStorage.removeItem(ORG_KEY)
          setUser(null)
          setOrganization(null)
          setOrganizations([])
        }
        // Any other error (timeout, network, 5xx): keep the cached user/token
        // as-is so the person stays logged in and can keep using cached data.
      })
      .finally(() => setLoading(false))
  }, [refreshUser])

  async function login(email, password) {
    const res = await api.post("/auth/login", { email, password })
    localStorage.setItem(TOKEN_KEY, res.data.token)
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
    lastActivityWriteRef.current = Date.now()

    // Always start a new session on the user's own organization. A previous
    // management session may have left another company's org selected.
    localStorage.removeItem(ORG_KEY)
    applyAuthData(normalizeAuthPayload(res.data))
    return res.data
  }

  async function switchOrganization(organizationId) {
    if (!organizationId || organizationId === organization?.id) return organization

    const allowed = organizations.find((org) => org.id === organizationId)
    if (!allowed) throw new Error("You do not have access to that organization")

    const previousId = organization?.id || user?.organization?.id
    localStorage.setItem(ORG_KEY, organizationId)

    try {
      const [orgRes, meRes] = await Promise.all([
        api.get("/organization"),
        api.get("/auth/me"),
      ])

      const normalized = normalizeAuthPayload(meRes.data)
      const nextOrganization = orgRes.data || normalized.organization || allowed
      const nextUser = normalized.user || user
      const nextOrganizations = normalized.organizations || organizations

      applyAuthData({
        user: nextUser,
        organization: nextOrganization,
        organizations: nextOrganizations,
      })

      return nextOrganization
    } catch (error) {
      if (previousId) localStorage.setItem(ORG_KEY, previousId)
      throw error
    }
  }

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_CACHE_KEY)
    localStorage.removeItem(ORG_KEY)
    localStorage.removeItem(LAST_ACTIVITY_KEY)
    setUser(null)
    setOrganization(null)
    setOrganizations([])
  }, [])

  useEffect(() => {
    if (!user) return undefined

    const handleActivity = () => markActivity()
    const events = ["pointerdown", "keydown", "touchstart", "scroll", "mousemove"]
    events.forEach((event) => window.addEventListener(event, handleActivity, { passive: true }))
    const handleVisibility = () => { if (document.visibilityState === "visible") markActivity() }
    document.addEventListener("visibilitychange", handleVisibility)
    markActivity()

    const interval = window.setInterval(() => {
      const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0)
      if (last && Date.now() - last >= INACTIVITY_LIMIT_MS) {
        logout()
      }
    }, 15000)

    return () => {
      events.forEach((event) => window.removeEventListener(event, handleActivity))
      document.removeEventListener("visibilitychange", handleVisibility)
      window.clearInterval(interval)
    }
  }, [user, markActivity, logout])

  return (
    <AuthContext.Provider value={{
      user,
      organization,
      organizations,
      loading,
      login,
      logout,
      refreshUser,
      switchOrganization,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}