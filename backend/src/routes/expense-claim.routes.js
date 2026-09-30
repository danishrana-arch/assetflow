const express = require("express")
const {
  listMyClaims,
  createClaim,
  deleteClaim,
  listClaims,
  approveClaim,
  rejectClaim,
} = require("../controllers/expense-claim.controller")
const { requireAuth, requireModule } = require("../middleware/auth.middleware")
const { noStore } = require("../middleware/cache.middleware")

const router = express.Router()

router.use(requireAuth)

// Self-service — any employee submits / withdraws their own claims.
router.get("/me", noStore, listMyClaims)
router.post("/", createClaim)
router.delete("/:id", deleteClaim)

// Verification — HR, ADMIN, CEO ("expenseClaims" module).
router.get("/", requireModule("expenseClaims"), noStore, listClaims)
router.post("/:id/approve", requireModule("expenseClaims"), approveClaim)
router.post("/:id/reject", requireModule("expenseClaims"), rejectClaim)

module.exports = router
