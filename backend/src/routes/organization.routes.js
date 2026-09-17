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
router.get("/comparison", requireRole("ADMIN", "CEO", "MANAGER"), getOrganizationComparison)
router.post("/suborganizations", requireRole("ADMIN", "CEO", "MANAGER"), createSubOrganization)
router.delete("/suborganizations/:id", requireRole("ADMIN", "CEO", "MANAGER"), archiveSubOrganization)
router.patch("/", requireRole("ADMIN", "CEO", "MANAGER"), updateOrganization)
router.patch("/company/set-main", requireRole("CEO"), setMainCompany)

router.get("/attendance-permissions/me", getMyAttendancePermission)
router.get("/attendance-permissions", requireRole("ADMIN", "CEO", "MANAGER"), getAttendancePermissions)
router.put("/attendance-permissions", requireRole("ADMIN", "CEO", "MANAGER"), updateAttendancePermissions)

module.exports = router
