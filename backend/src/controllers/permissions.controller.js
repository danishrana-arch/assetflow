const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")
const {
  ALWAYS_FULL_ATTENDANCE_ROLES,
  CONFIGURABLE_ATTENDANCE_ROLES,
  getAttendancePermission,
} = require("../utils/permissions")

async function getMyAttendancePermission(req, res, next) {
  try {
    const { organizationId, role, userId } = req.user
    const permission = await getAttendancePermission({ organizationId, role, userId })
    res.json(permission)
  } catch (err) {
    next(err)
  }
}

async function getAttendancePermissions(req, res, next) {
  try {
    const { organizationId } = req.user
    const rows = await prisma.attendancePermission.findMany({ where: { organizationId } })
    const byRole = new Map(rows.map((r) => [r.role, r]))

    const matrix = await Promise.all(
      CONFIGURABLE_ATTENDANCE_ROLES.map(async (role) => {
        const row = byRole.get(role)
        if (row) return { role, canCreate: row.canCreate, canRead: row.canRead, canUpdate: row.canUpdate, canDelete: row.canDelete }
        return { role, ...(await getAttendancePermission({ organizationId, role })) }
      })
    )

    res.json(matrix)
  } catch (err) {
    next(err)
  }
}

async function updateAttendancePermissions(req, res, next) {
  try {
    const { organizationId } = req.user
    const entries = Array.isArray(req.body?.permissions) ? req.body.permissions : []

    const updates = entries.filter(
      (entry) => entry?.role && CONFIGURABLE_ATTENDANCE_ROLES.includes(entry.role) && !ALWAYS_FULL_ATTENDANCE_ROLES.includes(entry.role)
    )

    const flags = (r) => (r ? { canCreate: r.canCreate, canRead: r.canRead, canUpdate: r.canUpdate, canDelete: r.canDelete } : null)
    const beforeRows = await prisma.attendancePermission.findMany({ where: { organizationId, role: { in: updates.map((u) => u.role) } } })

    await prisma.$transaction(
      updates.map((entry) =>
        prisma.attendancePermission.upsert({
          where: { organizationId_role: { organizationId, role: entry.role } },
          update: {
            canCreate: !!entry.canCreate,
            canRead: !!entry.canRead,
            canUpdate: !!entry.canUpdate,
            canDelete: !!entry.canDelete,
          },
          create: {
            organizationId,
            role: entry.role,
            canCreate: !!entry.canCreate,
            canRead: !!entry.canRead,
            canUpdate: !!entry.canUpdate,
            canDelete: !!entry.canDelete,
          },
        })
      )
    )

    if (updates.length) {
      const before = {}
      const after = {}
      for (const u of updates) {
        before[u.role] = flags(beforeRows.find((r) => r.role === u.role))
        after[u.role] = { canCreate: !!u.canCreate, canRead: !!u.canRead, canUpdate: !!u.canUpdate, canDelete: !!u.canDelete }
      }
      logAudit({
        organizationId,
        actorId: req.user.userId,
        action: "permissions.attendance_updated",
        targetType: "AttendancePermission",
        note: `Roles: ${updates.map((u) => u.role).join(", ")}`,
        details: { before, after },
      })
    }

    res.json({ saved: updates.length })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getMyAttendancePermission,
  getAttendancePermissions,
  updateAttendancePermissions,
}
