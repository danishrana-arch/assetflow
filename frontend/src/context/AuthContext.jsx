import { createContext, useContext, useEffect, useState, useCallback } from "react"
import api from "../api/client"

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [organization, setOrganization] = useState(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(() => {
    return api.get("/auth/me").then((res) => {
      setUser(res.data)
      setOrganization(res.data.organization)
      return res.data
    })
  }, [])

  useEffect(() => {
    const token = localStorage.getItem("assetflow_token")
    if (!token) {
      setLoading(false)
      return
    }
    refreshUser()
      .catch(() => localStorage.removeItem("assetflow_token"))
      .finally(() => setLoading(false))
  }, [refreshUser])

  async function login(email, password) {
    const res = await api.post("/auth/login", { email, password })
    localStorage.setItem("assetflow_token", res.data.token)
    setUser(res.data.user)
    setOrganization(res.data.organization)
    return res.data
  }

  function logout() {
    localStorage.removeItem("assetflow_token")
    setUser(null)
    setOrganization(null)
  }

  return (
    <AuthContext.Provider value={{ user, organization, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
