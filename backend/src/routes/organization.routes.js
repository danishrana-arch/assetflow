const express = require("express")
const {
  getOrganization,
  updateOrganization,
  listCompanyOrganizations,
  createSubOrganization,
  archiveSubOrganization,
  getOrganizationComparison,
  setMainCompany,
  setCompanyHierarchy,
  setOfficeType,
  listCallCenterAdmins,
  setCallCenterAccess,
  grantOrganizationAccess,
  revokeOrganizationAccess,
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
// Grand Parent CEO only (re-checked in the controller): { organizations: [...] }.
router.patch("/company/hierarchy", requireRole("CEO"), setCompanyHierarchy)
// CEO only: IT office / call center, and which admins reach every call center.
router.patch("/company/:id/office-type", requireRole("CEO"), setOfficeType)
router.get("/call-center-admins", requireRole("CEO"), listCallCenterAdmins)
router.patch("/call-center-admins/:userId", requireRole("CEO"), setCallCenterAccess)
// CEO only: which extra Admins / IT Managers may open this company.
router.post("/company/:id/access", requireRole("CEO"), grantOrganizationAccess)
router.delete("/company/:id/access/:userId", requireRole("CEO"), revokeOrganizationAccess)

router.get("/attendance-permissions/me", getMyAttendancePermission)
router.get("/attendance-permissions", requireRole("ADMIN", "CEO"), getAttendancePermissions)
router.put("/attendance-permissions", requireRole("ADMIN", "CEO"), updateAttendancePermissions)

module.exports = router
