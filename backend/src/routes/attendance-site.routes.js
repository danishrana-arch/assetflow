const express = require("express")
const {
  listSites,
  listAssignedSites,
  listSiteProjects,
  createSite,
  updateSite,
  assignEmployees,
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

module.exports = router
