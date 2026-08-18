const express = require("express")
const rateLimit = require("express-rate-limit")
const { registerOrganization, login, inviteEmployee, me, changePassword } = require("../controllers/auth.controller")
const { requireAuth, requireManagement } = require("../middleware/auth.middleware")

const router = express.Router()

// Brute-force protection on the credential-guessing endpoints. Keeps this
// independent of the general API limiter in index.js so a lockout here
// doesn't affect normal authenticated traffic.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in a few minutes." },
})

router.post("/register", authLimiter, registerOrganization)
router.post("/login", authLimiter, login)
router.get("/me", requireAuth, me)
router.post("/invite", requireAuth, requireManagement, inviteEmployee)
// Any authenticated user can change their OWN password — the controller
// verifies currentPassword before allowing the change, so this does not
// need an elevated role.
router.patch("/password", requireAuth, changePassword)

module.exports = router
