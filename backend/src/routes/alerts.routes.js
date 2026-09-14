const express = require("express")
const { getSmartAlerts } = require("../controllers/alerts.controller")
const { requireAuth } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)
router.get("/", getSmartAlerts)

module.exports = router
