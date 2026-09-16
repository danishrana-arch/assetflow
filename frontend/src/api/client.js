import axios from "axios"

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api"

const api = axios.create({
  baseURL: API_URL,
  timeout: 20000,
  headers: { Accept: "application/json" },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("assetflow_token")
  const organizationId = localStorage.getItem("assetflow_active_organization")

  if (token) config.headers.Authorization = `Bearer ${token}`
  if (organizationId) config.headers["X-Organization-Id"] = organizationId
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Only the session-check call (GET /auth/me, also used by
    // AuthContext's refreshUser()) should ever wipe the session on a 401.
    // A 401 from any other endpoint (e.g. a permission check on one
    // resource) must not log the user out from under them — just reject.
    const isSessionCheck = err.config?.method === "get" && /\/auth\/me$/.test(err.config?.url || "")
    if (err.response?.status === 401 && isSessionCheck) {
      localStorage.removeItem("assetflow_token")
      localStorage.removeItem("assetflow_user_cache")
      localStorage.removeItem("assetflow_active_organization")
      window.location.href = "/login"
    }
    return Promise.reject(err)
  }
)

export default api

export function getApiRoot() {
  return API_URL.replace(/\/api\/?$/, "")
}
