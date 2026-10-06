const express = require("express")
const {
  generatePayroll,
  previewPayroll,
  listPayroll,
  getPayrollSummary,
  myPayroll,
  updatePayroll,
  getPayrollDetails,
  createPayrollAdjustment,
  reversePayrollAdjustment,
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
const { listSalaryRevisions, createSalaryRevision } = require("../controllers/salary-revision.controller")
const { requireAuth, requireRole, requireModule } = require("../middleware/auth.middleware")
const { noStore } = require("../middleware/cache.middleware")

const router = express.Router()

router.use(requireAuth)

// Self-service — any authenticated employee sees only their own payslips.
router.get("/me", noStore, myPayroll)
// Own payslip for anyone; others' need the payroll module (checked inside).
// Salary increments / decrements + history (own history for anyone; the
// org's for payroll roles — checked in the controller).
router.get("/salary-revisions", noStore, listSalaryRevisions)
router.post("/salary-revisions", requireRole("ADMIN", "CEO", "HR"), createSalaryRevision)

router.get("/:id/pdf", noStore, downloadPayslipPdf)
// Breakdown + attendance days + adjustment history: own payslip, or the
// payroll module (checked inside).
router.get("/:id/details", noStore, getPayrollDetails)
// Manual, audited adjustments after generation. Role-by-status rules
// (DRAFT: ADMIN/HR/CEO, submitted: ADMIN/CEO, paid: CEO override) are
// enforced inside; the route only lets payroll roles through.
router.post("/:id/adjustments", requireRole("ADMIN", "HR", "CEO"), createPayrollAdjustment)
router.post("/:id/adjustments/:adjustmentId/reverse", requireRole("ADMIN", "HR", "CEO"), reversePayrollAdjustment)

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
