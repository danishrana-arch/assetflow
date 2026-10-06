const express = require("express")
const { listLateRules, createLateRule, updateLateRule, deleteLateRule } = require("../controllers/late-rule.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

// Everyone in the company can see the rules; ADMIN / CEO / HR manage them.
router.get("/", listLateRules)
router.post("/", requireRole("ADMIN", "CEO", "HR"), createLateRule)
router.patch("/:id", requireRole("ADMIN", "CEO", "HR"), updateLateRule)
router.delete("/:id", requireRole("ADMIN", "CEO", "HR"), deleteLateRule)

module.exports = router
