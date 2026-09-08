const express = require("express")
const {
  createEmployeeForm,
  listEmployeeForms,
  toggleEmployeeForm,
  getEmployeeFormSubmissions,
} = require("../controllers/employee-form.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")

const router = express.Router()
router.use(requireAuth, requireRole("ADMIN", "CEO"))
router.get("/", listEmployeeForms)
router.post("/", createEmployeeForm)
router.patch("/:id/toggle", toggleEmployeeForm)
router.get("/:id/submissions", getEmployeeFormSubmissions)
module.exports = router
