const express = require("express")
const {
  getOrganization,
  updateOrganization,
  listCompanyOrganizations,
  createSubOrganization,
  archiveSubOrganization,
  getOrganizationComparison,
  listAccessUsers,
  grantOrganizationAccess,
  revokeOrganizationAccess,
} = require("../controllers/organization.controller")
const {
  getMyAttendancePermission,
  getAttendancePermissions,
  updateAttendancePermissions,
} = require("../controllers/permissions.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")
const { requireFeature } = require("../utils/platform")

const router = express.Router()

router.use(requireAuth)

router.get("/", getOrganization)
router.get("/company", listCompanyOrganizations)
// ADMIN/CEO only — matches the frontend's RequireOwner.
router.get("/comparison", requireRole("ADMIN", "CEO"), requireFeature("orgComparison"), getOrganizationComparison)
router.patch("/", requireRole("ADMIN", "CEO"), updateOrganization)

// CEO only: add / remove companies and decide which Admins / IT Managers
// may open which company (utils/organization.js).
router.post("/suborganizations", requireRole("CEO"), createSubOrganization)
router.delete("/suborganizations/:id", requireRole("CEO"), archiveSubOrganization)
router.get("/access-users", requireRole("CEO"), listAccessUsers)
router.post("/company/:id/access", requireRole("CEO"), grantOrganizationAccess)
router.delete("/company/:id/access/:userId", requireRole("CEO"), revokeOrganizationAccess)

router.get("/attendance-permissions/me", getMyAttendancePermission)
router.get("/attendance-permissions", requireRole("ADMIN", "CEO"), getAttendancePermissions)
router.put("/attendance-permissions", requireRole("ADMIN", "CEO"), updateAttendancePermissions)

module.exports = router
