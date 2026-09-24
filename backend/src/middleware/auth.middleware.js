const { verifyToken } = require("../utils/jwt")
const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES, hasModuleAccess } = require("../utils/roles")

// Organization switching is intentionally asymmetric:
// - MAIN COMPANY ADMIN: may switch to any active organization in the company.
// - CEO: keeps the existing company-wide switching behavior.
// - SUB-ORGANIZATION ADMIN: is locked to their own organization.
// - All other roles: are locked to their own organization.
async function applyOrganizationScope(req) {
  const selectedOrganizationId = String(
    req.headers["x-organization-id"] || ""
  ).trim()

  if (!selectedOrganizationId) return

  const role = req.user.role
  const current = await prisma.organization.findUnique({
    where: { id: req.user.organizationId },
    select: {
      id: true,
      companyId: true,
      parentOrganizationId: true,
      archivedAt: true,
    },
  })

  if (!current) {
    const error = new Error("Your organization could not be found")
    error.statusCode = 403
    throw error
  }

  const companyId = current.companyId || current.id
  const isMainCompany =
    !current.parentOrganizationId &&
    (!current.companyId || current.companyId === current.id)

  // Selecting the user's own organization is always safe.
  if (selectedOrganizationId === current.id) return

  // Only a MAIN COMPANY ADMIN, a CEO, or a MAIN COMPANY IT_MANAGER may switch
  // to another organization. In particular, an ADMIN/IT_MANAGER belonging to
  // a sub-organization cannot use a forged X-Organization-Id header to read
  // or mutate another organization. IT_MANAGER's role-based nav/data access
  // stays inventory-scoped regardless of which organization is selected —
  // this only controls which organization's data they're allowed to select.
  const canSwitchCompanyWide =
    role === "CEO" ||
    ((role === "ADMIN" || role === "IT_MANAGER") && isMainCompany)

  if (!canSwitchCompanyWide) {
    const error = new Error(
      "You do not have access to another organization"
    )
    error.statusCode = 403
    throw error
  }

  const selectedOrganization = await prisma.organization.findFirst({
    where: {
      id: selectedOrganizationId,
      archivedAt: null,
      OR: [
        { id: companyId },
        { companyId },
      ],
    },
    select: {
      id: true,
      companyId: true,
      parentOrganizationId: true,
      archivedAt: true,
    },
  })

  if (!selectedOrganization) {
    const error = new Error(
      "You do not have access to this organization"
    )
    error.statusCode = 403
    throw error
  }

  req.user.organizationId = selectedOrganization.id
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
