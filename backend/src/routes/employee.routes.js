const express = require("express")
const multer = require("multer")
const {
  listEmployees,
  getEmployee,
  getEmployeeMonthActivity,
  updateEmployee,
  deleteEmployee,
  importEmployees,
  importTemplate,
  updateEmployeePhoto,
} = require("../controllers/employee.controller")
const { resetPassword } = require("../controllers/auth.controller")
const { listDocuments, uploadDocument, downloadDocument, deleteDocument } = require("../controllers/employee-document.controller")
const { requireAuth, requireRole, requireModule, requireModuleOrSelf } = require("../middleware/auth.middleware")
const { EMPLOYEE_DIRECTORY_ROLES } = require("../utils/roles")
const { noStore } = require("../middleware/cache.middleware")
const { isAcceptedSheet, sheetTypeError } = require("../utils/sheet")

const router = express.Router()

// Keep import files small and in memory only — never written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = isAcceptedSheet(file)
    cb(ok ? null : sheetTypeError(), ok)
  },
})

// Employee document pictures — memory only, type checked from the bytes in
// the controller.
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
})

router.use(requireAuth)

// Bulk add follows the same rule as single add: ADMIN/CEO/HR only.
router.get("/import/template", requireRole("ADMIN", "CEO", "HR"), importTemplate)
router.post("/import", requireRole("ADMIN", "CEO", "HR"), upload.single("file"), importEmployees)

// IT_MANAGER lacks the "employees" module but still needs this list as a
// redacted asset-assignment picker — see EMPLOYEE_DIRECTORY_ROLES.
router.get("/", requireRole(...EMPLOYEE_DIRECTORY_ROLES), listEmployees)
router.get("/:id", noStore, getEmployee)
// One month of attendance/leave/activity for the profile's month browser —
// same visibility rules as GET /:id (checked in the controller).
router.get("/:id/activity", noStore, getEmployeeMonthActivity)
// Documents: self (view) or ADMIN/CEO/HR — checked in the controller.
router.get("/:id/documents", noStore, listDocuments)
router.post("/:id/documents", requireRole("ADMIN", "CEO", "HR"), documentUpload.single("file"), uploadDocument)
router.get("/:id/documents/:docId/file", noStore, downloadDocument)
router.delete("/:id/documents/:docId", requireRole("ADMIN", "CEO", "HR"), deleteDocument)
// A role with the "employees" module can edit anyone; anyone else can only
// edit their own phone/email (enforced field-by-field in the controller).
router.patch("/:id", requireModuleOrSelf("employees"), updateEmployee)
// Profile picture: self, or ADMIN/CEO/HR (checked in the controller).
router.put("/:id/photo", updateEmployeePhoto)
// Admin-assisted "forgot password" — resets to a known temp password since
// there's no email-reset flow. ADMIN/CEO can reset anyone; HR can reset
// anyone except an ADMIN/CEO (enforced inside the controller, since that
// needs the *target*'s role, not just the requester's) — deliberately not
// gated by the "employees" module alone, since MANAGEMENT/DEPARTMENT_HEAD
// also have that module for directory access but must not be able to
// reset any password at all.
router.post("/:id/reset-password", requireRole("ADMIN", "CEO", "HR"), resetPassword)
router.delete("/:id", requireRole("ADMIN", "CEO"), deleteEmployee)

module.exports = router
