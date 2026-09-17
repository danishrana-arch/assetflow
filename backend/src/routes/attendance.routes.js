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
const { requireAuth } = require("../middleware/auth.middleware")
const { requireAttendancePermission } = require("../utils/permissions")
const { startAttendanceAutoAbsentJob } = require("../services/attendance-auto-absent.service")

const router = express.Router()

router.use(requireAuth)

startAttendanceAutoAbsentJob()

// Self-service — any authenticated employee, own record only.
router.get("/self", getSelfAttendance)
router.post("/self/mark", markSelfAttendance)
router.post("/self/offline-sync", syncOfflineAttendance)
router.post("/self/corrections", createAttendanceCorrection)

// Full attendance grid — gated by the per-role Attendance permission matrix
// (Settings), not a fixed role list. ADMIN/CEO/MANAGER are always full
// access; everyone else is whatever's configured (HR defaults to read-only).
router.get("/", requireAttendancePermission("canRead"), getDailyAttendance)
router.post("/mark", requireAttendancePermission("canCreate", "canUpdate"), markAttendance)
router.post("/save", requireAttendancePermission("canCreate", "canUpdate"), saveDayAttendance)
router.get("/export", requireAttendancePermission("canRead"), exportAttendanceSheet)
router.get("/anomalies", requireAttendancePermission("canRead"), getAttendanceAnomalies)
router.patch("/anomalies/:id/resolve", requireAttendancePermission("canUpdate"), resolveAttendanceAnomaly)
router.get("/corrections", requireAttendancePermission("canRead"), listAttendanceCorrections)

module.exports = router
