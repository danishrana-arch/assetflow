const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES } = require("./roles")

async function createNotification({
  organizationId,
  recipientId,
  createdById = null,
  type = "INFO",
  title,
  message = null,
  link = null,
}) {
  if (!organizationId || !recipientId || !title) return null

  return prisma.notification.create({
    data: {
      organizationId,
      recipientId,
      createdById,
      type,
      title: String(title).slice(0, 200),
      message: message ? String(message).slice(0, 1000) : null,
      link: link ? String(link).slice(0, 300) : null,
    },
  })
}

async function notifyManagement({ organizationId, createdById, type, title, message, link }) {
  const users = await prisma.user.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      role: { in: MANAGEMENT_ROLES },
      ...(createdById ? { id: { not: createdById } } : {}),
    },
    select: { id: true },
  })

  if (!users.length) return []

  return prisma.notification.createMany({
    data: users.map((user) => ({
      organizationId,
      recipientId: user.id,
      createdById: createdById || null,
      type: type || "REQUEST",
      title: String(title).slice(0, 200),
      message: message ? String(message).slice(0, 1000) : null,
      link: link ? String(link).slice(0, 300) : null,
    })),
  })
}

async function notifyUsers({ organizationId, recipientIds, createdById, type, title, message, link }) {
  const ids = [...new Set((recipientIds || []).filter(Boolean))].filter((id) => id !== createdById)
  if (!ids.length) return []

  return prisma.notification.createMany({
    data: ids.map((recipientId) => ({
      organizationId,
      recipientId,
      createdById: createdById || null,
      type: type || "INFO",
      title: String(title).slice(0, 200),
      message: message ? String(message).slice(0, 1000) : null,
      link: link ? String(link).slice(0, 300) : null,
    })),
  })
}

module.exports = { createNotification, notifyManagement, notifyUsers }
