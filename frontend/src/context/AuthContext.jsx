import { createContext, useContext, useEffect, useState, useCallback } from "react"
import api from "../api/client"

const AuthContext = createContext(null)
const TOKEN_KEY = "assetflow_token"
const ORG_KEY = "assetflow_active_organization"
const USER_CACHE_KEY = "assetflow_user_cache"

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

export function AuthProvider({ children }) {
  const cached = readCachedUser()
  const [user, setUser] = useState(cached?.user || null)
  const [organization, setOrganization] = useState(cached?.organization || cached?.user?.organization || null)
  const [organizations, setOrganizations] = useState(cached?.organizations || normalizeOrganizations(cached?.user, []))
  const [loading, setLoading] = useState(!cached?.user)

  const applyAuthData = useCallback((data) => {
    const nextOrganizations = normalizeOrganizations(data.user, data.organizations || [])
    const active = pickActiveOrganization(data.user, nextOrganizations)

    setUser(data.user)
    setOrganizations(nextOrganizations)
    setOrganization(data.organization || active)

    if (active?.id) localStorage.setItem(ORG_KEY, active.id)
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify({
      user: data.user,
      organization: data.organization || active,
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
    refreshUser()
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_CACHE_KEY)
        localStorage.removeItem(ORG_KEY)
        setUser(null)
        setOrganization(null)
        setOrganizations([])
      })
      .finally(() => setLoading(false))
  }, [refreshUser])

  async function login(email, password) {
    const res = await api.post("/auth/login", { email, password })
    localStorage.setItem(TOKEN_KEY, res.data.token)

    // Always start a new session on the user's own organization. A previous
    // management session may have left another company's org selected.
    localStorage.removeItem(ORG_KEY)
    applyAuthData(res.data)
    return res.data
  }

  async function switchOrganization(organizationId) {
    if (!organizationId || organizationId === organization?.id) return organization

    const allowed = organizations.find((org) => org.id === organizationId)
    if (!allowed) throw new Error("You do not have access to that organization")

    const previousId = organization?.id || user?.organization?.id
    localStorage.setItem(ORG_KEY, organizationId)
    try {
      const res = await api.get("/organization")
      setOrganization(res.data)
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify({ user, organization: res.data, organizations }))
      return res.data
    } catch (error) {
      if (previousId) localStorage.setItem(ORG_KEY, previousId)
      throw error
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_CACHE_KEY)
    localStorage.removeItem(ORG_KEY)
    setUser(null)
    setOrganization(null)
    setOrganizations([])
  }

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
