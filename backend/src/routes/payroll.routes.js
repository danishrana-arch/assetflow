const express = require("express")
const {
  generatePayroll,
  listPayroll,
  getPayrollSummary,
  myPayroll,
  updatePayroll,
  createEmployeePayslip,
  applyTaxToMonth,
  downloadPayslipPdf,
  markPaid,
  deletePayroll,
  submitForApproval,
  approveAndPayAll,
  rejectBatch,
  deleteAllForMonth,
} = require("../controllers/payroll.controller")
const { requireAuth, requireRole, requireModule } = require("../middleware/auth.middleware")
const { noStore } = require("../middleware/cache.middleware")

const router = express.Router()

router.use(requireAuth)

// Self-service — any authenticated employee sees only their own payslips.
router.get("/me", noStore, myPayroll)
// Own payslip for anyone; others' need the payroll module (checked inside).
router.get("/:id/pdf", noStore, downloadPayslipPdf)

router.get("/", requireModule("payroll"), noStore, listPayroll)
router.get("/summary", requireModule("payrollReports"), noStore, getPayrollSummary)
router.post("/generate", requireRole("ADMIN"), generatePayroll)
// Single employee's payslip regardless of status — for a termination /
// final payslip of someone already marked "Left Company".
router.post("/employee", requireRole("ADMIN"), createEmployeePayslip)
// One tax % for every DRAFT payslip of a month.
router.post("/tax", requireRole("ADMIN"), applyTaxToMonth)
// An admin's final step: send a generated month to the CEO.
router.post("/submit", requireRole("ADMIN"), submitForApproval)

// CEO-only: salaries are paid from the CEO's own account, so approval,
// payout, and bulk cleanup are exclusively theirs.
router.post("/approve", requireRole("CEO"), approveAndPayAll)
router.post("/reject", requireRole("CEO"), rejectBatch)
router.delete("/bulk", requireRole("CEO"), deleteAllForMonth)

router.patch("/:id", requireRole("ADMIN"), updatePayroll)
router.post("/:id/mark-paid", requireRole("CEO"), markPaid)
router.delete("/:id", requireRole("ADMIN", "CEO"), deletePayroll)

module.exports = router
