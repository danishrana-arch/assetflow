const express = require("express")
const { listAuditLog } = require("../controllers/audit.controller")
const { requireAuth, requireManagement } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth, requireManagement)
router.get("/", listAuditLog)

module.exports = router
