const express = require("express")
const {
  exportEmployees,
  exportInventory,
  exportDepartments,
  exportTickets,
} = require("../controllers/export.controller")
const { requireAuth, requireManagement } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth, requireManagement)

router.get("/employees", exportEmployees)
router.get("/inventory", exportInventory)
router.get("/departments", exportDepartments)
router.get("/tickets", exportTickets)

module.exports = router
