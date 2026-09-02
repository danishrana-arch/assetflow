const { verifyToken } = require("../utils/jwt")
const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES } = require("../utils/roles")

// CEO and ADMIN can switch the active organization inside their company.
// The frontend sends the selected organization as X-Organization-Id. All
// other roles are permanently scoped to the organization stored in their JWT.
async function applyOrganizationScope(req) {
  const selectedOrganizationId = String(req.headers["x-organization-id"] || "").trim()
  if (!selectedOrganizationId) return

  if (!["ADMIN", "CEO"].includes(req.user.role)) return
  if (selectedOrganizationId === req.user.organizationId) return

  const companyId = req.user.companyId || (await prisma.organization.findUnique({
    where: { id: req.user.organizationId },
    select: { companyId: true },
  }))?.companyId

  const selectedOrganization = await prisma.organization.findUnique({
    where: { id: selectedOrganizationId },
    select: { id: true, companyId: true, archivedAt: true },
  })

  if (!companyId || !selectedOrganization || selectedOrganization.archivedAt || companyId !== selectedOrganization.companyId) {
    const error = new Error("You do not have access to this organization")
    error.statusCode = 403
    throw error
  }

  req.user.organizationId = selectedOrganization.id
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ""
  const token = header.startsWith("Bearer ") ? header.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: "Missing authentication token" })
  }

  try {
    const decoded = verifyToken(token)

    // Refresh authorization-critical identity from the database on every
    // request. The JWT still authenticates the session, but role/company/org
    // changes made by an ADMIN/CEO take effect immediately instead of leaving
    // a stale role in the browser until the token expires.
    const dbUser = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        organizationId: true,
        role: true,
        status: true,
        organization: { select: { companyId: true, archivedAt: true } },
      },
    })

    if (!dbUser || dbUser.status === "LEFT_COMPANY" || dbUser.organization?.archivedAt) {
      return res.status(401).json({ error: "Your account or organization is no longer active" })
    }

    req.user = {
      ...decoded,
      userId: dbUser.id,
      organizationId: dbUser.organizationId,
      companyId: dbUser.organization?.companyId || decoded.companyId,
      role: dbUser.role,
    }

    await applyOrganizationScope(req)
    next()
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
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
    if (["ADMIN", "CEO"].includes(req.user?.role)) return next()

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
