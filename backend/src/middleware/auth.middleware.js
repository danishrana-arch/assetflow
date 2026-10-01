const { verifyToken } = require("../utils/jwt")
const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES, hasModuleAccess } = require("../utils/roles")
const { HIERARCHY_SELECT, canAccessOrganization } = require("../utils/organization")

// Organization switching (X-Organization-Id) follows the company hierarchy —
// see utils/organization.js. Strictly downward for ADMIN / IT_MANAGER
// (Grand Parent → Parent → Children; Parent → Children; Child → own only);
// a CEO may enter any company of their group; HR and every other role are
// locked to their own organization. This is THE enforcement point for every
// organization-scoped API: controllers read req.user.organizationId, which
// only changes here and only to an organization the user may access.
// The requested id is never trusted — it's re-checked against the DB.
async function applyOrganizationScope(req) {
  const selectedOrganizationId = String(
    req.headers["x-organization-id"] || ""
  ).trim()

  if (!selectedOrganizationId) return

  const role = req.user.role
  const home = await prisma.organization.findUnique({
    where: { id: req.user.homeOrganizationId },
    select: HIERARCHY_SELECT,
  })

  if (!home) {
    const error = new Error("Your organization could not be found")
    error.statusCode = 403
    throw error
  }

  // Selecting the user's own organization is always safe.
  if (selectedOrganizationId === home.id) return

  const target = await prisma.organization.findUnique({
    where: { id: selectedOrganizationId },
    select: HIERARCHY_SELECT,
  })

  if (!canAccessOrganization(role, home, target)) {
    const error = new Error(
      "You do not have access to this organization"
    )
    error.statusCode = 403
    throw error
  }

  req.user.organizationId = target.id
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ""

  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : null

  if (!token) {
    return res.status(401).json({
      error: "Missing authentication token",
    })
  }

  try {
    const decoded = verifyToken(token)

    const dbUser = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        organizationId: true,
        role: true,
        status: true,
        departmentId: true,
        organization: {
          select: {
            companyId: true,
            parentOrganizationId: true,
            archivedAt: true,
          },
        },
      },
    })

    if (
      !dbUser ||
      dbUser.status === "LEFT_COMPANY" ||
      dbUser.organization?.archivedAt
    ) {
      return res.status(401).json({
        error: "Your account or organization is no longer active",
      })
    }

    req.user = {
      ...decoded,
      userId: dbUser.id,
      organizationId: dbUser.organizationId,
      // Never changes during the request (organizationId may, via the
      // organization switcher) — use it for "what may this user reach?".
      homeOrganizationId: dbUser.organizationId,
      companyId:
        dbUser.organization?.companyId || decoded.companyId,
      role: dbUser.role,
      departmentId: dbUser.departmentId,
    }

    await applyOrganizationScope(req)

    next()
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
      })
    }

    return res.status(401).json({
      error: "Invalid or expired token",
    })
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Insufficient permissions",
      })
    }

    next()
  }
}

function requireManagement(req, res, next) {
  if (
    !req.user ||
    !MANAGEMENT_ROLES.includes(req.user.role)
  ) {
    return res.status(403).json({
      error: "This action requires a management role",
    })
  }

  next()
}

function requireManagementOrSelf(req, res, next) {
  const isSelf = req.user?.userId === req.params.id

  if (
    !req.user ||
    (!MANAGEMENT_ROLES.includes(req.user.role) && !isSelf)
  ) {
    return res.status(403).json({
      error: "You can only edit your own profile",
    })
  }

  next()
}

// Inventory is IT_MANAGER-only (plus ADMIN/CEO, who have every module).
// See ROLE_MODULES in utils/roles.js.
function requireInventoryAccess(req, res, next) {
  const allowedRoles = ["ADMIN", "CEO", "IT_MANAGER"]

  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      error: "Inventory access is restricted to authorized roles",
    })
  }

  next()
}

// Generic module gate — the backend counterpart to hasModuleAccess() used
// by the frontend nav/route guards. ADMIN/CEO always pass via the "*"
// wildcard in ROLE_MODULES; every other role is checked against its own
// fixed module list.
function requireModule(moduleKey) {
  return (req, res, next) => {
    if (!req.user || !hasModuleAccess(req.user.role, moduleKey)) {
      return res.status(403).json({
        error: "You do not have access to this module",
      })
    }
    next()
  }
}

// Same as requireModule, but also lets a user through onto their own
// record (e.g. PATCH /employees/:id) even without the module.
function requireModuleOrSelf(moduleKey) {
  return (req, res, next) => {
    const isSelf = req.user?.userId === req.params.id
    if (!req.user || (!hasModuleAccess(req.user.role, moduleKey) && !isSelf)) {
      return res.status(403).json({
        error: "You do not have access to this module",
      })
    }
    next()
  }
}

module.exports = {
  requireAuth,
  requireRole,
  requireManagement,
  requireManagementOrSelf,
  requireInventoryAccess,
  requireModule,
  requireModuleOrSelf,
}
