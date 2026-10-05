const express = require("express")
const {
  listMySites,
  getSiteRoster,
  markSiteAttendance,
  syncSiteAttendance,
  requestSiteCorrection,
  getSiteAdminHistory,
} = require("../controllers/site-admin.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")
const { noStore } = require("../middleware/cache.middleware")

// Site Admin / Project Manager workspace. SITE_ADMIN only; every handler
// re-checks that the site is assigned to the caller and the employee
// belongs to it (controllers/site-admin.controller.js).
const router = express.Router()
router.use(requireAuth, requireRole("SITE_ADMIN"))

router.get("/sites", noStore, listMySites)
router.get("/sites/:siteId/roster", noStore, getSiteRoster)
router.post("/attendance", markSiteAttendance)
router.post("/sync", syncSiteAttendance)
router.post("/corrections", requestSiteCorrection)
router.get("/history", noStore, getSiteAdminHistory)

module.exports = router
