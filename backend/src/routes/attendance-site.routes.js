const express = require("express")
const {
  listSites,
  listAssignedSites,
  listSiteProjects,
  createSite,
  updateSite,
  assignEmployees,
  listSiteAdminCandidates,
  setSiteAdmins,
  verifySiteLocation,
  deleteSite,
} = require("../controllers/attendance-site.controller")
const { requireAuth } = require("../middleware/auth.middleware")
const { noStore } = require("../middleware/cache.middleware")

const router = express.Router()
router.use(requireAuth)

router.get("/assigned", noStore, listAssignedSites)
router.get("/projects", listSiteProjects)
router.post("/verify", verifySiteLocation)
router.get("/", listSites)
router.post("/", createSite)
router.patch("/:id", updateSite)
router.delete("/:id", deleteSite)
router.put("/:id/employees", noStore, assignEmployees)
// Site Admin / Project Manager assignment — ADMIN/CEO only (checked inside).
router.get("/site-admin-candidates", noStore, listSiteAdminCandidates)
router.put("/:id/admins", noStore, setSiteAdmins)

module.exports = router
