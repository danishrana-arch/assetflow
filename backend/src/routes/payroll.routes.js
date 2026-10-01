const express = require("express")
const {
  generatePayroll,
  previewPayroll,
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
// Read-only review of what Generate would produce for a month.
router.get("/preview", requireModule("payroll"), noStore, previewPayroll)
router.post("/generate", requireRole("ADMIN", "HR"), generatePayroll)
// Single employee's payslip regardless of status — for a termination /
// final payslip of someone already marked "Left Company".
router.post("/employee", requireRole("ADMIN", "HR"), createEmployeePayslip)
// One tax % for every DRAFT payslip of a month.
router.post("/tax", requireRole("ADMIN", "HR"), applyTaxToMonth)
// ADMIN or HR prepares payroll (generate / edit drafts / tax / submit);
// the final step sends a generated month to the CEO.
router.post("/submit", requireRole("ADMIN", "HR"), submitForApproval)

// CEO-only: salaries are paid from the CEO's own account, so approval,
// payout, and bulk cleanup are exclusively theirs.
router.post("/approve", requireRole("CEO"), approveAndPayAll)
router.post("/reject", requireRole("CEO"), rejectBatch)
router.delete("/bulk", requireRole("CEO"), deleteAllForMonth)

router.patch("/:id", requireRole("ADMIN", "HR"), updatePayroll)
router.post("/:id/mark-paid", requireRole("CEO"), markPaid)
router.delete("/:id", requireRole("ADMIN", "CEO"), deletePayroll)

module.exports = router
