const express = require("express")
const { getOrganization, updateOrganization } = require("../controllers/organization.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.get("/", getOrganization)
router.patch("/", requireRole("ADMIN", "CEO"), updateOrganization)

module.exports = router
