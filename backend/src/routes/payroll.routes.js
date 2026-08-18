const express = require("express")
const {
  generatePayroll,
  listPayroll,
  myPayroll,
  updatePayroll,
  markPaid,
  deletePayroll,
  submitForApproval,
  approveAndPayAll,
  rejectBatch,
  deleteAllForMonth,
} = require("../controllers/payroll.controller")
const { requireAuth, requireManagement, requireRole } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

// Self-service — any authenticated employee sees only their own payslips.
router.get("/me", myPayroll)

router.get("/", requireManagement, listPayroll)
router.post("/generate", requireRole("ADMIN"), generatePayroll)
// An admin/owner's final step: send a generated month to the CEO.
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
