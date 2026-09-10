const prisma = require("../lib/prisma")

async function listNotifications(req, res, next) {
  try {
    const { userId, organizationId } = req.user
    const notifications = await prisma.notification.findMany({
      where: { organizationId, recipientId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    res.json(notifications)
  } catch (err) {
    next(err)
  }
}

async function unreadCount(req, res, next) {
  try {
    const { userId, organizationId } = req.user
    const count = await prisma.notification.count({
      where: { organizationId, recipientId: userId, readAt: null },
    })
    res.json({ count })
  } catch (err) {
    next(err)
  }
}

async function markAllRead(req, res, next) {
  try {
    const { userId, organizationId } = req.user
    await prisma.notification.updateMany({
      where: { organizationId, recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
}

async function markRead(req, res, next) {
  try {
    const { userId, organizationId } = req.user
    const notification = await prisma.notification.findFirst({
      where: { id: req.params.id, organizationId, recipientId: userId },
    })
    if (!notification) return res.status(404).json({ error: "Notification not found" })
    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { readAt: notification.readAt || new Date() },
    })
    res.json(updated)
  } catch (err) {
    next(err)
  }
}

module.exports = { listNotifications, unreadCount, markAllRead, markRead }
