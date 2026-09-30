const express = require("express")
const { requireAuth } = require("../middleware/auth.middleware")
const { noStore } = require("../middleware/cache.middleware")
const { getFeed, resetFeed, serveFeed } = require("../controllers/calendar-feed.controller")

const router = express.Router()

// Public: Google Calendar / Outlook fetch this without our auth header.
router.get("/feed/:token.ics", serveFeed)

router.get("/feed", requireAuth, noStore, getFeed)
router.post("/feed/reset", requireAuth, noStore, resetFeed)

module.exports = router
