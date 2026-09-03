const { verifyToken } = require("../utils/jwt")
const prisma = require("../lib/prisma")
const {
  MANAGEMENT_ROLES,
  PAYROLL_ROLES,
  INVENTORY_ROLES,
  EMPLOYEE_DIRECTORY_ROLES,
} = require("../utils/roles")

// CEO and ADMIN can switch the active organization inside their company.
// All other roles remain scoped to the organization stored on their account.
async function applyOrganizationScope(req) {
  const selectedOrganizationId = String(req.headers["x-organization-id"] || "").trim()
  if (!selectedOrganizationId) return

  if (!req.user || !["ADMIN", "CEO"].includes(req.user.role)) return
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

async function refreshCurrentUser(req) {
  const current = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: {
      id: true,
      role: true,
      status: true,
      organizationId: true,
      canManageAttendance: true,
      organization: { select: { companyId: true, archivedAt: true } },
      department: { select: { id: true, name: true } },
    },
  })

  if (!current || current.status === "LEFT_COMPANY" || current.organization?.archivedAt) {
    const error = new Error("Your account is no longer active")
    error.statusCode = 401
    throw error
  }

  // The database is the source of truth for permissions. This prevents an
  // old JWT from retaining a role after an ADMIN/CEO changes it.
  req.user.role = current.role
  req.user.organizationId = current.organizationId
  req.user.companyId = current.organization?.companyId
  req.user.canManageAttendance = current.canManageAttendance
  req.user.department = current.department
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ""
  const token = header.startsWith("Bearer ") ? header.slice(7) : null

  if (!token) return res.status(401).json({ error: "Missing authentication token" })

  try {
    const decoded = verifyToken(token)
    req.user = decoded
    await refreshCurrentUser(req)
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

function requireInventoryAccess(req, res, next) {
  if (!req.user || !INVENTORY_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: "Inventory access is limited to ADMIN, CEO, HR, and IT Manager" })
  }
  next()
}

function requireEmployeeDirectory(req, res, next) {
  if (!req.user || !EMPLOYEE_DIRECTORY_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: "Employee directory access is restricted" })
  }
  next()
}

function requirePayrollAccess(req, res, next) {
  if (!req.user || !PAYROLL_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: "Payroll access is limited to ADMIN, CEO, and HR" })
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
    if (["ADMIN", "CEO", "HR"].includes(req.user?.role)) return next()

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } })
    if (!user || !user.canManageAttendance) {
      return res.status(403).json({ error: "Attendance access is limited to management and HR" })
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
  requireInventoryAccess,
  requireEmployeeDirectory,
  requirePayrollAccess,
  requireManagementOrSelf,
  requireAttendanceAccess,
}
