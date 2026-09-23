const express = require("express")
const { listAuditLog } = require("../controllers/audit.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")

const router = express.Router()

// The audit log is a security/compliance trail, not a per-role module in
// the tree — kept ADMIN/CEO-only rather than opened up to every management
// role the way it was before.
router.use(requireAuth, requireRole("ADMIN", "CEO"))
router.get("/", listAuditLog)

module.exports = router
