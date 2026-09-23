const express = require("express")
const {
  createEmployeeForm,
  sendEmployeeFormNotifications,
  listEmployeeForms,
  toggleEmployeeForm,
  getEmployeeFormSubmissions,
} = require("../controllers/employee-form.controller")
const { requireAuth, requireModule } = require("../middleware/auth.middleware")

const router = express.Router()
router.use(requireAuth, requireModule("employeeForms"))
router.get("/", listEmployeeForms)
router.post("/", createEmployeeForm)
router.post("/:id/send", sendEmployeeFormNotifications)
router.patch("/:id/toggle", toggleEmployeeForm)
router.get("/:id/submissions", getEmployeeFormSubmissions)
module.exports = router
