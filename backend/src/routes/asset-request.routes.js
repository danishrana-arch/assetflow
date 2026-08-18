const express = require("express")
const {
  createRequest,
  listRequests,
  reviewRequest,
  fulfillRequest,
  cancelRequest,
} = require("../controllers/asset-request.controller")
const { requireAuth, requireManagement } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.post("/", createRequest)
router.get("/", listRequests) // controller scopes results to "own" for non-management
router.patch("/:id/review", requireManagement, reviewRequest)
router.post("/:id/fulfill", requireManagement, fulfillRequest)
router.delete("/:id", cancelRequest)

module.exports = router
