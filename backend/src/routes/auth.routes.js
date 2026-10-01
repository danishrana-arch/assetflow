const express = require("express")
const rateLimit = require("express-rate-limit")
const { registerOrganization, login, inviteEmployee, me, changePassword, forgotPassword, resetPasswordWithToken } = require("../controllers/auth.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")

const router = express.Router()

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in a few minutes." },
})

router.post("/register", authLimiter, registerOrganization)
router.post("/login", authLimiter, login)
// Public, self-service password reset via an emailed one-time link.
router.post("/forgot-password", authLimiter, forgotPassword)
router.post("/reset-password", authLimiter, resetPasswordWithToken)
router.get("/me", requireAuth, me)
// Adding employees is ADMIN/CEO/HR only (HR limited to non-owner roles inside inviteEmployee).
router.post("/invite", requireAuth, requireRole("ADMIN", "CEO", "HR"), inviteEmployee)
// Any authenticated user can change their OWN password — the controller
// verifies currentPassword before allowing the change, so this does not
// need an elevated role.
router.patch("/password", requireAuth, changePassword)

module.exports = router
