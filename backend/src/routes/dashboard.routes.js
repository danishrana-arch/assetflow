const express = require("express")
const {
  getStats,
  getRecentActivity,
  getLatestAssets,
  getInventoryActivitySeries,
  getRepairSpend,
} = require("../controllers/dashboard.controller")
const { requireAuth, requireManagement } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.get("/stats", getStats)
router.get("/activity", getRecentActivity)
router.get("/latest-assets", getLatestAssets)
// Custom date-range inventory activity chart — management only.
router.get("/inventory-activity", requireManagement, getInventoryActivitySeries)
router.get("/repair-spend", requireManagement, getRepairSpend)

module.exports = router
