const express = require("express")
const { createInvitation, listInvitations, resendInvitation, cancelInvitation } = require("../controllers/invitation.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")
const { noStore } = require("../middleware/cache.middleware")

// Email invitations for new employees — same people who can add employees.
const router = express.Router()
router.use(requireAuth, requireRole("ADMIN", "CEO", "HR"), noStore)
router.get("/", listInvitations)
router.post("/", createInvitation)
router.post("/:id/resend", resendInvitation)
router.delete("/:id", cancelInvitation)
module.exports = router
