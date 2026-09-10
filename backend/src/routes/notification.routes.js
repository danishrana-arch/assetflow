const express = require("express")
const { listNotifications, unreadCount, markAllRead, markRead } = require("../controllers/notification.controller")
const { requireAuth } = require("../middleware/auth.middleware")

const router = express.Router()
router.use(requireAuth)
router.get("/", listNotifications)
router.get("/unread-count", unreadCount)
router.post("/read-all", markAllRead)
router.post("/:id/read", markRead)

module.exports = router
