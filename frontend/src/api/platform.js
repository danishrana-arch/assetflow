import api from "./client"

// Everything the Control Center needs, one function per call (/api/platform/*,
// platform administrators only). Plan/sale methods share the names of the
// company Billing API so the same plan components work with either.
const get = (url, params) => api.get(url, { params }).then((r) => r.data)

export const platformApi = {
  overview: () => get("/platform/overview"),

  organizations: () => get("/platform/organizations"),
  organization: (id) => get(`/platform/organizations/${id}`),
  organizationPeople: (id) => get(`/platform/organizations/${id}/people`),
  organizationFeatures: (id) => get(`/platform/organizations/${id}/features`),
  organizationPermissions: (id) => get(`/platform/organizations/${id}/permissions`),
  organizationActivity: (id) => get(`/platform/organizations/${id}/activity`),
  organizationInvoices: (id) => get(`/platform/organizations/${id}/invoices`),
  createOrganization: (body) => api.post("/platform/organizations", body).then((r) => r.data),
  suspendOrganization: (id, reason) => api.post(`/platform/organizations/${id}/suspend`, { reason }).then((r) => r.data),
  unsuspendOrganization: (id) => api.post(`/platform/organizations/${id}/unsuspend`).then((r) => r.data),
  deleteOrganization: (id, confirmName) => api.delete(`/platform/organizations/${id}`, { data: { confirmName } }),
  setAttendancePermissions: (id, permissions) => api.put(`/platform/organizations/${id}/attendance-permissions`, { permissions }).then((r) => r.data),
  renameOrganization: (id, name) => api.patch(`/platform/organizations/${id}`, { name }).then((r) => r.data),
  setOrganizationStatus: (id, status, reason) => api.post(`/platform/organizations/${id}/status`, { status, reason }).then((r) => r.data),
  setOrganizationFeature: (id, key, enabled, note) => api.put(`/platform/organizations/${id}/features/${key}`, { enabled, note }).then((r) => r.data),
  assignSubscription: (id, body) => api.post(`/platform/organizations/${id}/subscription`, body).then((r) => r.data),
  cancelSubscription: (id, reason) => api.post(`/platform/organizations/${id}/subscription/cancel`, { reason }).then((r) => r.data),

  users: (params) => get("/platform/users", params),
  createUser: (body) => api.post("/platform/users", body).then((r) => r.data),
  updateUser: (id, body) => api.patch(`/platform/users/${id}`, body).then((r) => r.data),
  deleteUser: (id) => api.delete(`/platform/users/${id}`),
  resetUserPassword: (id) => api.post(`/platform/users/${id}/reset-password`).then((r) => r.data),
  changeUserRole: (id, role, reason) => api.patch(`/platform/users/${id}/role`, { role, reason }).then((r) => r.data),
  roles: () => get("/platform/roles"),
  createRole: (body) => api.post("/platform/roles/custom", body).then((r) => r.data),
  updateRole: (id, body) => api.patch(`/platform/roles/custom/${id}`, body).then((r) => r.data),
  deleteRole: (id) => api.delete(`/platform/roles/custom/${id}`),

  features: () => get("/platform/features"),
  setFeatureAvailability: (key, enabled) => api.patch(`/platform/features/${key}`, { enabled }).then((r) => r.data),

  // Same names as billingApi, so PlanEditorModal / SaleModal work unchanged.
  plans: () => get("/platform/plans"),
  createPlan: (body) => api.post("/platform/plans", body).then((r) => r.data),
  updatePlan: (id, body) => api.patch(`/platform/plans/${id}`, body).then((r) => r.data),
  deletePlan: (id) => api.delete(`/platform/plans/${id}`),
  setSale: (id, body) => api.put(`/platform/plans/${id}/sale`, body).then((r) => r.data),
  endSale: (id) => api.delete(`/platform/plans/${id}/sale`).then((r) => r.data),

  subscriptions: () => get("/platform/subscriptions"),
  invoices: (params) => get("/platform/invoices", params),
  inquiries: () => get("/platform/inquiries"),
  deleteInquiry: (id) => api.delete(`/platform/inquiries/${id}`),
  setInquiryStatus: (id, status) => api.patch(`/platform/inquiries/${id}`, { status }).then((r) => r.data),

  usage: () => get("/platform/usage"),
  audit: (params) => get("/platform/audit", params),
  system: () => get("/platform/system"),
}
