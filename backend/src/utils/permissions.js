const prisma = require("../lib/prisma")

// These roles are always full-access on Attendance and can never be
// downgraded through the AttendancePermission table — the Settings matrix
// only ever shows/edits the other, configurable roles.
const ALWAYS_FULL_ATTENDANCE_ROLES = ["ADMIN", "CEO", "MANAGER"]

// Roles an ADMIN/CEO/MANAGER can actually configure from the matrix.
const CONFIGURABLE_ATTENDANCE_ROLES = [
  "HR",
  "SALES_HEAD",
  "MANAGEMENT",
  "DEPARTMENT_HEAD",
  "IT_MANAGER",
  "EMPLOYEE",
]

const FULL_ACCESS = { canCreate: true, canRead: true, canUpdate: true, canDelete: true }
const NO_ACCESS = { canCreate: false, canRead: false, canUpdate: false, canDelete: false }

// Preserves current behavior for any role with no explicit row yet: HR
// could always at least see attendance before this table existed, so it
// keeps that by default now — just read-only instead of full access,
// matching the "HR should default to read-only" requirement. Everyone else
// defaults to no access, unless the legacy per-user canManageAttendance
// override (the only permission flag that existed before this table) says
// otherwise.
async function defaultAttendancePermission(role, userId) {
  if (role === "HR") return { ...NO_ACCESS, canRead: true }

  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { canManageAttendance: true } })
    if (user?.canManageAttendance) return { ...FULL_ACCESS }
  }

  return { ...NO_ACCESS }
}

async function getAttendancePermission({ organizationId, role, userId }) {
  if (ALWAYS_FULL_ATTENDANCE_ROLES.includes(role)) return { ...FULL_ACCESS }

  const row = await prisma.attendancePermission.findUnique({
    where: { organizationId_role: { organizationId, role } },
  })
  if (row) return { canCreate: row.canCreate, canRead: row.canRead, canUpdate: row.canUpdate, canDelete: row.canDelete }

  return defaultAttendancePermission(role, userId)
}

// Express middleware — passes if the requester has at least one of the
// named actions (e.g. requireAttendancePermission("canCreate", "canUpdate")
// for an upsert-style endpoint that should accept either).
function requireAttendancePermission(...actions) {
  return async (req, res, next) => {
    try {
      const permission = await getAttendancePermission({
        organizationId: req.user.organizationId,
        role: req.user.role,
        userId: req.user.userId,
      })
      if (!actions.some((action) => permission[action])) {
        return res.status(403).json({ error: "You do not have permission to do that on Attendance" })
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

module.exports = {
  ALWAYS_FULL_ATTENDANCE_ROLES,
  CONFIGURABLE_ATTENDANCE_ROLES,
  getAttendancePermission,
  requireAttendancePermission,
}
