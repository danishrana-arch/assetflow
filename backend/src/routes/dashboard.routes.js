const express = require("express")
const {
  getStats, getRecentActivity, getLatestAssets, getInventoryActivitySeries, getRepairSpend,
  getExecutiveOverview, getAttendanceAnomalies, listAnnouncements, createAnnouncement, deleteAnnouncement,
} = require("../controllers/dashboard.controller")
const { requireAuth, requireManagement } = require("../middleware/auth.middleware")

const router = express.Router()
router.use(requireAuth)
router.get("/stats", getStats)
router.get("/activity", getRecentActivity)
router.get("/latest-assets", getLatestAssets)
router.get("/inventory-activity", requireManagement, getInventoryActivitySeries)
router.get("/repair-spend", requireManagement, getRepairSpend)
router.get("/executive", requireManagement, getExecutiveOverview)
router.get("/attendance-anomalies", requireManagement, getAttendanceAnomalies)
router.get("/announcements", listAnnouncements)
router.post("/announcements", requireManagement, createAnnouncement)
router.delete("/announcements/:id", requireManagement, deleteAnnouncement)
module.exports = router
