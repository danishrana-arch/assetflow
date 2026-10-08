const { verifyToken } = require("../utils/jwt")
const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES, userHasModule, runWithAccess } = require("../utils/roles")
const { ORG_ACCESS_SELECT, canAccessOrganization } = require("../utils/organization")
const { isModuleEntitled } = require("../utils/features")

// Organization switching (X-Organization-Id) follows utils/organization.js:
// a CEO may enter any company of their group; an ADMIN / IT_MANAGER only
// their own plus the companies a CEO gave them; HR and every other role are
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
    select: ORG_ACCESS_SELECT,
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
    select: { ...ORG_ACCESS_SELECT, subscription: { select: { status: true } } },
  })

  if (!canAccessOrganization(role, home, target, { grantedOrganizationIds: req.user.grantedOrganizationIds })) {
    const error = new Error(
      "You do not have access to this organization"
    )
    error.statusCode = 403
    throw error
  }

  if (target.subscription?.status === "SUSPENDED") {
    const error = new Error("This organization has been suspended for an overdue payment. Please contact ManagementDock to restore access.")
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
        email: true,
        organizationId: true,
        role: true,
        status: true,
        departmentId: true,
        accessGrants: { select: { organizationId: true } },
        customRole: { select: { modules: true } },
        organization: {
          select: {
            companyId: true,
            archivedAt: true,
            subscription: { select: { status: true } },
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

    // A company that hasn't paid is switched off by the platform team.
    if (dbUser.organization?.subscription?.status === "SUSPENDED" && dbUser.role !== "PLATFORM_ADMIN") {
      return res.status(401).json({
        error: "This organization has been suspended for an overdue payment. Please contact ManagementDock to restore access.",
        code: "ORGANIZATION_SUSPENDED",
      })
    }

    req.user = {
      ...decoded,
      userId: dbUser.id,
      email: dbUser.email,
      organizationId: dbUser.organizationId,
      // Never changes during the request (organizationId may, via the
      // organization switcher) — use it for "what may this user reach?".
      homeOrganizationId: dbUser.organizationId,
      companyId:
        dbUser.organization?.companyId || decoded.companyId,
      role: dbUser.role,
      departmentId: dbUser.departmentId,
      grantedOrganizationIds: dbUser.accessGrants.map((g) => g.organizationId),
      // Control Center custom role: its modules replace the base role's.
      customModules: dbUser.customRole ? dbUser.customRole.modules : null,
    }

    await applyOrganizationScope(req)

    // Everything after this (handlers included) runs with the user's module
    // access in scope — see runWithAccess in utils/roles.js.
    return runWithAccess({ role: req.user.role, customModules: req.user.customModules }, () => next())
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
// On top of the role check, the organization must be entitled to the module's
// feature (plan + overrides, utils/features.js).
function requireModule(moduleKey) {
  return async (req, res, next) => {
    if (!req.user || !userHasModule(req.user, moduleKey)) {
      return res.status(403).json({
        error: "You do not have access to this module",
      })
    }
    if (!(await isModuleEntitled(req.user.organizationId, moduleKey))) {
      return res.status(403).json({
        error: "This feature isn't included in your organization's plan",
        code: "FEATURE_NOT_ENTITLED",
      })
    }
    next()
  }
}

// Same as requireModule, but also lets a user through onto their own
// record (e.g. PATCH /employees/:id) even without the module.
function requireModuleOrSelf(moduleKey) {
  return async (req, res, next) => {
    const isSelf = req.user?.userId === req.params.id
    const roleAllows = !!req.user && userHasModule(req.user, moduleKey)
    if (!req.user || (!roleAllows && !isSelf)) {
      return res.status(403).json({
        error: "You do not have access to this module",
      })
    }
    // Own record stays reachable; module access needs the entitlement too.
    if (roleAllows && !isSelf && !(await isModuleEntitled(req.user.organizationId, moduleKey))) {
      return res.status(403).json({
        error: "This feature isn't included in your organization's plan",
        code: "FEATURE_NOT_ENTITLED",
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
