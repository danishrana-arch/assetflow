const express = require("express")
const c = require("../controllers/billing.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")
const { noStore } = require("../middleware/cache.middleware")

const router = express.Router()

// Billing is for the people who run the company. Plan/sale/inquiry-status
// changes are further limited inside the controller (canManagePlans).
router.use(requireAuth, requireRole("ADMIN", "CEO"), noStore)

router.get("/subscription", c.getSubscription)
router.post("/subscription", c.changePlan)
router.post("/portal", c.openPortal)
router.get("/invoices", c.listInvoices)

router.get("/plans", c.listPlans)
router.post("/plans", c.createPlan)
router.patch("/plans/:id", c.updatePlan)
router.delete("/plans/:id", c.deletePlan)
router.put("/plans/:id/sale", c.setSale)
router.delete("/plans/:id/sale", c.clearSale)

router.get("/inquiries", c.listInquiries)
router.post("/inquiries", c.createInquiry)
router.patch("/inquiries/:id", c.updateInquiry)
router.delete("/inquiries/:id", c.deleteInquiry)

module.exports = router
