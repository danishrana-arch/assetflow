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
  listSelfAttendanceCorrections,
  reviewAttendanceCorrection,
  setAttendanceNote,
  setAttendanceFine,
  setFineSettings,
  reviewEmployeeNote,
} = require("../controllers/attendance.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")
const { requireAttendancePermission } = require("../utils/permissions")
const { startAttendanceAutoAbsentJob } = require("../services/attendance-auto-absent.service")
const { startAttendanceCheckoutJob } = require("../services/attendance-checkout.service")

const router = express.Router()

router.use(requireAuth)

// Set DISABLE_BACKGROUND_JOBS=true to run an API instance without them (tests).
if (process.env.DISABLE_BACKGROUND_JOBS !== "true") {
  startAttendanceAutoAbsentJob()
  startAttendanceCheckoutJob()
}

// Self-service — any authenticated employee, own record only.
router.get("/self", getSelfAttendance)
router.post("/self/mark", markSelfAttendance)
router.post("/self/offline-sync", syncOfflineAttendance)
router.post("/self/corrections", createAttendanceCorrection)
router.get("/self/corrections", listSelfAttendanceCorrections)
// Employees no longer write their own day note / extra hours — notes are
// HR/ADMIN/CEO only (PUT /notes); an employee sends a correction request
// instead. The route stays so old clients get a clear 403, not a 404.
router.put("/self/note", (req, res) => res.status(403).json({ error: "Notes are added by HR. To fix your check-in or check-out time, send a correction request." }))

// Full attendance grid — gated by the per-role Attendance permission matrix
// (Settings), not a fixed role list. ADMIN/CEO are always full access;
// everyone else is whatever's configured (HR defaults to read-only,
// MANAGEMENT/DEPARTMENT_HEAD default to full — see utils/permissions.js).
router.get("/", requireAttendancePermission("canRead"), getDailyAttendance)
router.post("/mark", requireAttendancePermission("canCreate", "canUpdate"), markAttendance)
router.post("/save", requireAttendancePermission("canCreate", "canUpdate"), saveDayAttendance)
router.get("/export", requireAttendancePermission("canRead"), exportAttendanceSheet)
router.get("/anomalies", requireAttendancePermission("canRead"), getAttendanceAnomalies)
router.patch("/anomalies/:id/resolve", requireAttendancePermission("canUpdate"), resolveAttendanceAnomaly)
router.get("/corrections", requireAttendancePermission("canRead"), listAttendanceCorrections)
router.patch("/corrections/:id", requireAttendancePermission("canUpdate"), reviewAttendanceCorrection)
// Day notes: written only by HR/ADMIN/CEO (a fixed role rule, independent of
// the permission matrix); still requires being able to read the grid.
router.put("/notes", requireAttendancePermission("canRead"), requireRole("ADMIN", "CEO", "HR"), setAttendanceNote)
// Fines (waive the automatic late/absent fine, add a manual one) and acting
// on an employee's own note — same fixed HR/ADMIN/CEO rule as day notes.
router.put("/fine-settings", requireAttendancePermission("canRead"), requireRole("ADMIN", "CEO", "HR"), setFineSettings)
router.put("/fines",requireAttendancePermission("canRead"), requireRole("ADMIN", "CEO", "HR"), setAttendanceFine)
router.put("/employee-note", requireAttendancePermission("canRead"), requireRole("ADMIN", "CEO", "HR"), reviewEmployeeNote)

module.exports = router
