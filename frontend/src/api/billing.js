import api from "./client"

// Everything the Billing page needs from the server, one function per call.
// Payment-provider (Stripe) work happens on the backend only — the browser
// just receives a hosted-checkout URL to redirect to.
export const billingApi = {
  plans: () => api.get("/billing/plans").then((r) => r.data),
  createPlan: (body) => api.post("/billing/plans", body).then((r) => r.data),
  updatePlan: (id, body) => api.patch(`/billing/plans/${id}`, body).then((r) => r.data),
  deletePlan: (id) => api.delete(`/billing/plans/${id}`),
  setSale: (id, body) => api.put(`/billing/plans/${id}/sale`, body).then((r) => r.data),
  endSale: (id) => api.delete(`/billing/plans/${id}/sale`).then((r) => r.data),

  subscription: () => api.get("/billing/subscription").then((r) => r.data),
  changePlan: (planKey) => api.post("/billing/subscription", { planKey }).then((r) => r.data),
  openPortal: () => api.post("/billing/portal").then((r) => r.data),

  invoices: () => api.get("/billing/invoices").then((r) => r.data),

  inquiries: () => api.get("/billing/inquiries").then((r) => r.data),
  sendInquiry: (body) => api.post("/billing/inquiries", body).then((r) => r.data),
  setInquiryStatus: (id, status) => api.patch(`/billing/inquiries/${id}`, { status }).then((r) => r.data),
  deleteInquiry: (id) => api.delete(`/billing/inquiries/${id}`),
}

export const errorText = (err, fallback = "Something went wrong — please try again") =>
  err?.response?.data?.error || fallback
