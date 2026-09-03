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
const { requireAuth, requireManagement, requireManagementOrSelf, requireRole, requireEmployeeDirectory } = require("../middleware/auth.middleware")

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

router.get("/import/template", requireManagement, importTemplate)
router.post("/import", requireManagement, upload.single("file"), importEmployees)

router.get("/", requireEmployeeDirectory, listEmployees)
router.get("/:id", getEmployee)
// Management can edit anyone; a non-management user can edit their own
// phone/email only (enforced field-by-field in the controller).
router.patch("/:id", requireManagementOrSelf, updateEmployee)
// Admin-assisted "forgot password" — management resets to a known temp
// password since there's no email-reset flow.
router.post("/:id/reset-password", requireManagement, resetPassword)
router.delete("/:id", requireRole("ADMIN", "CEO"), deleteEmployee)

module.exports = router
