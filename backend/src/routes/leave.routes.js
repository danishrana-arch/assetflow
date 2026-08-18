const express = require("express")
const {
  createLeave,
  listLeaves,
  getLeave,
  getLeaveBalance,
  getLeaveCalendar,
  reviewLeave,
  cancelLeave,
} = require("../controllers/leave.controller")
const { requireAuth, requireManagement } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.post("/", createLeave)
router.get("/", listLeaves) // controller scopes results to "own" for non-management
router.get("/balance", getLeaveBalance) // ?year=&employeeId= (employeeId is management-only)
router.get("/calendar", requireManagement, getLeaveCalendar) // ?year=&month=
router.get("/:id", getLeave)
router.patch("/:id/review", requireManagement, reviewLeave)
router.delete("/:id", cancelLeave)

module.exports = router
