const express = require("express")
const {
  getOrganization,
  updateOrganization,
  listCompanyOrganizations,
  createSubOrganization,
  archiveSubOrganization,
} = require("../controllers/organization.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.get("/", getOrganization)
router.get("/company", listCompanyOrganizations)
router.post("/suborganizations", requireRole("ADMIN", "CEO"), createSubOrganization)
router.delete("/suborganizations/:id", requireRole("ADMIN", "CEO"), archiveSubOrganization)
router.patch("/", requireRole("ADMIN", "CEO"), updateOrganization)

module.exports = router
