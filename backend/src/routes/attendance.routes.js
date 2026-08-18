const express = require("express")
const {
  getDailyAttendance,
  markAttendance,
  saveDayAttendance,
  exportAttendanceSheet,
  markSelfAttendance,
  getSelfAttendance,
} = require("../controllers/attendance.controller")
const { requireAuth, requireAttendanceAccess } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

// Self-service — any authenticated employee, own record only.
router.get("/self", getSelfAttendance)
router.post("/self/mark", markSelfAttendance)

// Full attendance grid — designated attendance admins / owner only.
router.get("/", requireAttendanceAccess, getDailyAttendance)
router.post("/mark", requireAttendanceAccess, markAttendance)
router.post("/save", requireAttendanceAccess, saveDayAttendance)
router.get("/export", requireAttendanceAccess, exportAttendanceSheet)

module.exports = router
