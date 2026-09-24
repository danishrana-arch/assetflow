const express = require("express")
const {
  createEmployeeForm,
  sendEmployeeFormNotifications,
  listEmployeeForms,
  toggleEmployeeForm,
  updateEmployeeForm,
  deleteEmployeeForm,
  getEmployeeFormSubmissions,
  deleteEmployeeFormSubmission,
} = require("../controllers/employee-form.controller")
const { requireAuth, requireModule } = require("../middleware/auth.middleware")

const router = express.Router()
router.use(requireAuth, requireModule("employeeForms"))
router.get("/", listEmployeeForms)
router.post("/", createEmployeeForm)
router.post("/:id/send", sendEmployeeFormNotifications)
router.patch("/:id/toggle", toggleEmployeeForm)
router.patch("/:id", updateEmployeeForm)
router.delete("/:id", deleteEmployeeForm)
router.get("/:id/submissions", getEmployeeFormSubmissions)
router.delete("/:id/submissions/:submissionId", deleteEmployeeFormSubmission)
module.exports = router
