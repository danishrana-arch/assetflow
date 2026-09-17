const express = require("express")
const {
  getDailyAttendance,
  markAttendance,
  saveDayAttendance,
  exportAttendanceSheet,
  markSelfAttendance,
  getSelfAttendance,
  syncOfflineAttendance,
  getAttendanceAnomalies,
  resolveAttendanceAnomaly,
  createAttendanceCorrection,
  listAttendanceCorrections,
} = require("../controllers/attendance.controller")
const { requireAuth, requireAttendanceAccess } = require("../middleware/auth.middleware")
const { startAttendanceAutoAbsentJob } = require("../services/attendance-auto-absent.service")

const router = express.Router()

router.use(requireAuth)

startAttendanceAutoAbsentJob()

// Self-service — any authenticated employee, own record only.
router.get("/self", getSelfAttendance)
router.post("/self/mark", markSelfAttendance)
router.post("/self/offline-sync", syncOfflineAttendance)
router.post("/self/corrections", createAttendanceCorrection)

// Full attendance grid — designated attendance admins / owner only.
router.get("/", requireAttendanceAccess, getDailyAttendance)
router.post("/mark", requireAttendanceAccess, markAttendance)
router.post("/save", requireAttendanceAccess, saveDayAttendance)
router.get("/export", requireAttendanceAccess, exportAttendanceSheet)
router.get("/anomalies", requireAttendanceAccess, getAttendanceAnomalies)
router.patch("/anomalies/:id/resolve", requireAttendanceAccess, resolveAttendanceAnomaly)
router.get("/corrections", requireAttendanceAccess, listAttendanceCorrections)

module.exports = router
