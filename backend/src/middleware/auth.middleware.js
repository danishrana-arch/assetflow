const { verifyToken } = require("../utils/jwt")
const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES } = require("../utils/roles")

function requireAuth(req, res, next) {
  const header = req.headers.authorization || ""
  const token = header.startsWith("Bearer ") ? header.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: "Missing authentication token" })
  }

  try {
    const decoded = verifyToken(token)
    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" })
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" })
    }
    next()
  }
}

// Any of the management roles (ADMIN, CEO, SALES_HEAD, HR).
function requireManagement(req, res, next) {
  if (!req.user || !MANAGEMENT_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: "This action requires a management role" })
  }
  next()
}

function requireManagementOrSelf(req, res, next) {
  const isSelf = req.user?.userId === req.params.id
  if (!req.user || (!MANAGEMENT_ROLES.includes(req.user.role) && !isSelf)) {
    return res.status(403).json({ error: "You can only edit your own profile" })
  }
  next()
}

async function requireAttendanceAccess(req, res, next) {
  try {
    if (req.user?.role === "ADMIN") return next()

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } })
    if (!user || !user.canManageAttendance) {
      return res.status(403).json({ error: "Attendance access is limited to designated admins" })
    }
    next()
  } catch (err) {
    next(err)
  }
}

module.exports = { requireAuth, requireRole, requireManagement, requireManagementOrSelf, requireAttendanceAccess }
