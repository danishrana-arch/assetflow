const express = require("express")
const multer = require("multer")
const {
  listEmployees,
  getEmployee,
  updateEmployee,
  deleteEmployee,
  importEmployees,
  importTemplate,
} = require("../controllers/employee.controller")
const { resetPassword } = require("../controllers/auth.controller")
const { requireAuth, requireRole, requireModule, requireModuleOrSelf } = require("../middleware/auth.middleware")
const { EMPLOYEE_DIRECTORY_ROLES } = require("../utils/roles")
const { noStore } = require("../middleware/cache.middleware")

const router = express.Router()

// Keep import files small and in memory only — never written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = /csv|comma-separated-values|text\/plain/i.test(file.mimetype) || /\.csv$/i.test(file.originalname)
    cb(ok ? null : new Error("Only .csv files are supported"), ok)
  },
})

router.use(requireAuth)

router.get("/import/template", requireModule("employees"), importTemplate)
router.post("/import", requireModule("employees"), upload.single("file"), importEmployees)

// IT_MANAGER lacks the "employees" module but still needs this list as a
// redacted asset-assignment picker — see EMPLOYEE_DIRECTORY_ROLES.
router.get("/", requireRole(...EMPLOYEE_DIRECTORY_ROLES), listEmployees)
router.get("/:id", noStore, getEmployee)
// A role with the "employees" module can edit anyone; anyone else can only
// edit their own phone/email (enforced field-by-field in the controller).
router.patch("/:id", requireModuleOrSelf("employees"), updateEmployee)
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
