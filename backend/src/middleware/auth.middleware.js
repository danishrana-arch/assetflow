const { verifyToken } = require("../utils/jwt")
const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES } = require("../utils/roles")

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

  // Only a MAIN COMPANY ADMIN or a CEO may switch to another organization.
  // In particular, an ADMIN belonging to a sub-organization cannot use a
  // forged X-Organization-Id header to read or mutate another organization.
  const canSwitchCompanyWide =
    role === "CEO" || (role === "ADMIN" && isMainCompany)

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

function requireInventoryAccess(req, res, next) {
  const allowedRoles = [
    "ADMIN",
    "CEO",
    "HR",
    "IT_MANAGER",
  ]

  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      error: "Inventory access is restricted to authorized roles",
    })
  }

  next()
}

async function requireAttendanceAccess(req, res, next) {
  try {
    if (["ADMIN", "CEO"].includes(req.user?.role)) {
      return next()
    }

    if (req.user?.role === "HR") {
      return next()
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        canManageAttendance: true,
      },
    })

    if (!user || !user.canManageAttendance) {
      return res.status(403).json({
        error:
          "Attendance access is limited to designated admins",
      })
    }

    next()
  } catch (err) {
    next(err)
  }
}

module.exports = {
  requireAuth,
  requireRole,
  requireManagement,
  requireManagementOrSelf,
  requireInventoryAccess,
  requireAttendanceAccess,
}
