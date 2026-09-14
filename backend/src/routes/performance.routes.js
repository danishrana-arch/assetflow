const express = require("express")
const { requireAuth } = require("../middleware/auth.middleware")
const { listPerformanceReviews, createPerformanceReview } = require("../controllers/performance.controller")
const router = express.Router()
router.use(requireAuth)
router.get("/:employeeId", listPerformanceReviews)
router.post("/:employeeId", createPerformanceReview)
module.exports = router
