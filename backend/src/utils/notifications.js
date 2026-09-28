const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES, ROLE_MODULES, hasModuleAccess } = require("./roles")

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

// `moduleKey` narrows recipients to roles that can actually open the linked
// page (e.g. "assetRequests" -> ADMIN/CEO/IT_MANAGER, not HR/MANAGEMENT).
// Without it, a management role lacking the module got a notification whose
// link just bounced them back to their own profile.
async function notifyManagement({ organizationId, createdById, type, title, message, link, moduleKey }) {
  const roles = moduleKey
    ? Object.keys(ROLE_MODULES).filter((role) => hasModuleAccess(role, moduleKey))
    : MANAGEMENT_ROLES
  const users = await prisma.user.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      role: { in: roles },
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
