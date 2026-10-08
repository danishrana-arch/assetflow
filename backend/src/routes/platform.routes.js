const express = require("express")
const c = require("../controllers/platform.controller")
const billing = require("../controllers/billing.controller")
const crud = require("../controllers/platform-crud.controller")
const { requireAuth } = require("../middleware/auth.middleware")
const { requirePlatformAdmin } = require("../utils/platform")
const { noStore } = require("../middleware/cache.middleware")

const router = express.Router()

// The Control Center: platform-wide administration. Never reachable by a
// company ADMIN/CEO — only the separate PLATFORM_ADMIN account.
router.use(requireAuth, requirePlatformAdmin, noStore)

router.get("/overview", c.overview)

router.get("/organizations", c.listOrganizations)
router.get("/organizations/:id", c.getOrganization)
router.post("/organizations", crud.createOrganization)
router.patch("/organizations/:id", c.renameOrganization)
router.post("/organizations/:id/suspend", crud.suspendOrganization)
router.post("/organizations/:id/unsuspend", crud.unsuspendOrganization)
router.delete("/organizations/:id", crud.deleteOrganization)
router.put("/organizations/:id/attendance-permissions", crud.setAttendancePermissions)
router.post("/organizations/:id/status", c.setOrganizationStatus)
router.get("/organizations/:id/people", c.listOrganizationPeople)
router.get("/organizations/:id/features", c.getOrganizationFeatureList)
router.put("/organizations/:id/features/:key", c.setOrganizationFeature)
router.get("/organizations/:id/permissions", c.getOrganizationPermissions)
router.get("/organizations/:id/activity", c.getOrganizationActivity)
router.get("/organizations/:id/invoices", c.getOrganizationInvoices)
router.post("/organizations/:id/subscription", c.assignSubscription)
router.post("/organizations/:id/subscription/cancel", c.cancelSubscription)

router.get("/users", c.listUsers)
router.post("/users", crud.createUser)
router.patch("/users/:id", crud.updateUser)
router.delete("/users/:id", crud.deleteUser)
router.post("/users/:id/reset-password", crud.resetUserPassword)
router.patch("/users/:id/role", c.changeUserRole)
router.get("/roles", c.listRoles)
router.post("/roles/custom", crud.createCustomRole)
router.patch("/roles/custom/:id", crud.updateCustomRole)
router.delete("/roles/custom/:id", crud.deleteCustomRole)

router.get("/features", c.listFeatures)
router.patch("/features/:key", c.setFeatureAvailability)

// Plans and sales reuse the billing module's handlers — one implementation.
router.get("/plans", billing.listPlans)
router.post("/plans", billing.createPlan)
router.patch("/plans/:id", billing.updatePlan)
router.delete("/plans/:id", billing.deletePlan)
router.put("/plans/:id/sale", billing.setSale)
router.delete("/plans/:id/sale", billing.clearSale)
router.get("/inquiries", billing.listInquiries)
router.patch("/inquiries/:id", billing.updateInquiry)
router.delete("/inquiries/:id", billing.deleteInquiry)

router.get("/subscriptions", c.listSubscriptions)
router.get("/invoices", c.listInvoices)
router.get("/usage", c.listUsage)
router.get("/audit", c.listAudit)
router.get("/system", c.systemSettings)

module.exports = router
