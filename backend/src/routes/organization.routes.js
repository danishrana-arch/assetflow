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
const {
  getMyAttendancePermission,
  getAttendancePermissions,
  updateAttendancePermissions,
} = require("../controllers/permissions.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.get("/", getOrganization)
router.get("/company", listCompanyOrganizations)
// ADMIN/CEO only — matches the frontend's RequireOwner.
router.get("/comparison", requireRole("ADMIN", "CEO"), getOrganizationComparison)
router.post("/suborganizations", requireRole("ADMIN", "CEO"), createSubOrganization)
router.delete("/suborganizations/:id", requireRole("ADMIN", "CEO"), archiveSubOrganization)
router.patch("/", requireRole("ADMIN", "CEO"), updateOrganization)
router.patch("/company/set-main", requireRole("CEO"), setMainCompany)

router.get("/attendance-permissions/me", getMyAttendancePermission)
router.get("/attendance-permissions", requireRole("ADMIN", "CEO"), getAttendancePermissions)
router.put("/attendance-permissions", requireRole("ADMIN", "CEO"), updateAttendancePermissions)

module.exports = router
