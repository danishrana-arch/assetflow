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
const { requireAuth, requireModule } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.post("/", createLeave)
router.get("/", listLeaves) // controller scopes results to "own" unless the requester has the "leave" module
router.get("/balance", getLeaveBalance) // ?year=&employeeId= (employeeId requires the "leave" module)
router.get("/calendar", requireModule("leave"), getLeaveCalendar) // ?year=&month=
router.get("/:id", getLeave)
router.patch("/:id/review", requireModule("leave"), reviewLeave)
router.delete("/:id", cancelLeave)

module.exports = router
