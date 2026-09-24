const express = require("express")
const { requireAuth } = require("../middleware/auth.middleware")
const {
  listPerformanceReviews,
  createPerformanceReview,
  listAllPerformanceReviews,
  createPerformanceReviewForEmployee,
  updatePerformanceReview,
  deletePerformanceReview,
} = require("../controllers/performance.controller")
const router = express.Router()
router.use(requireAuth)
// Org-wide (Performance.jsx) — employeeId comes from the body on create.
router.get("/", listAllPerformanceReviews)
router.post("/", createPerformanceReviewForEmployee)
// Edit/delete a single review by its own id. Safe alongside the
// per-employee GET/POST "/:employeeId" below — different HTTP methods on
// the same single-segment path pattern don't collide in Express.
router.patch("/:id", updatePerformanceReview)
router.delete("/:id", deletePerformanceReview)
// Per-employee (Employee360.jsx) — employeeId is in the URL.
router.get("/:employeeId", listPerformanceReviews)
router.post("/:employeeId", createPerformanceReview)
module.exports = router
