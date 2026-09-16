const express = require("express")
const {
  getOrganization,
  updateOrganization,
  listCompanyOrganizations,
  createSubOrganization,
  archiveSubOrganization,
  getOrganizationComparison,
  setMainCompany,
} = require("../controllers/organization.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.get("/", getOrganization)
router.get("/company", listCompanyOrganizations)
router.get("/comparison", requireRole("ADMIN", "CEO"), getOrganizationComparison)
router.post("/suborganizations", requireRole("ADMIN", "CEO"), createSubOrganization)
router.delete("/suborganizations/:id", requireRole("ADMIN", "CEO"), archiveSubOrganization)
router.patch("/", requireRole("ADMIN", "CEO"), updateOrganization)
router.patch("/company/set-main", requireRole("CEO"), setMainCompany)

module.exports = router
