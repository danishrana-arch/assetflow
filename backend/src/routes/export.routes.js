const express = require("express")
const {
  exportEmployees,
  exportInventory,
  exportDepartments,
  exportTickets,
} = require("../controllers/export.controller")
const { requireAuth, requireModule } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

// Each export is gated by the module it actually belongs to, rather than
// one blanket "any management role" check.
router.get("/employees", requireModule("employees"), exportEmployees)
router.get("/inventory", requireModule("inventory"), exportInventory)
router.get("/departments", requireModule("departments"), exportDepartments)
router.get("/tickets", requireModule("tickets"), exportTickets)

module.exports = router
