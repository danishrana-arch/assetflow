const express = require("express")
const { getHrReportOptions, generateHrReport } = require("../controllers/hr-report.controller")
const { requireAuth, requireModule } = require("../middleware/auth.middleware")
const { noStore } = require("../middleware/cache.middleware")

const router = express.Router()

// Same module gate as the HR Reports page itself (ADMIN, CEO, HR). The
// controller further limits every query to the caller's authorized
// organizations. Responses contain employee PII, so they're never cached.
router.use(requireAuth, requireModule("hrReports"), noStore)

router.get("/options", getHrReportOptions)
router.get("/", generateHrReport)

module.exports = router
