const prisma = require("../lib/prisma")

// `details` is optional structured data — platform actions pass
// { before, after } so the Control Center can show what changed.
async function logAudit({ organizationId, actorId, action, targetType, targetId, note, details }) {
  try {
    await prisma.auditLog.create({
      data: { organizationId, actorId: actorId || null, action, targetType, targetId, note, ...(details ? { details } : {}) },
    })
  } catch (err) {
    console.error("audit log failed:", err)
  }
}

module.exports = { logAudit }
