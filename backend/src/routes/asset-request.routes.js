const express = require("express")
const {
  createRequest,
  listRequests,
  reviewRequest,
  fulfillRequest,
  cancelRequest,
} = require("../controllers/asset-request.controller")
const { requireAuth, requireModule } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.post("/", createRequest)
router.get("/", listRequests) // controller scopes results to "own" for non-management
// Review/fulfill is IT_MANAGER's own module now (previously gated behind
// requireManagement, which doesn't include IT_MANAGER — so an IT manager
// could see "Asset Requests" in nav but got a 403 reviewing/fulfilling one).
router.patch("/:id/review", requireModule("assetRequests"), reviewRequest)
router.post("/:id/fulfill", requireModule("assetRequests"), fulfillRequest)
router.delete("/:id", cancelRequest)

module.exports = router
