const prisma = require("../lib/prisma")

async function logAudit({ organizationId, actorId, action, targetType, targetId, note }) {
  try {
    await prisma.auditLog.create({
      data: { organizationId, actorId: actorId || null, action, targetType, targetId, note },
    })
  } catch (err) {
    console.error("audit log failed:", err)
  }
}

module.exports = { logAudit }
