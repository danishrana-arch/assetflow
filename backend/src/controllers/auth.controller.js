const bcrypt = require("bcrypt")
const crypto = require("crypto")
const prisma = require("../lib/prisma")
const { signToken } = require("../utils/jwt")
const { ASSIGNABLE_ROLES, MAX_CEO_COUNT } = require("../utils/roles")
const { encryptField } = require("../utils/crypto")
const { logAudit } = require("../utils/audit")


function organizationSummary(organization) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    companyId: organization.companyId,
    parentOrganizationId: organization.parentOrganizationId,
    isMain: organization.id === organization.companyId,
    primaryColor: organization.primaryColor,
    accentColor: organization.accentColor,
    theme: organization.theme,
    planTier: organization.planTier,
  }
}

async function getCompanyOrganizations(companyId) {
  const organizations = await prisma.organization.findMany({
    where: { companyId, archivedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      companyId: true,
      parentOrganizationId: true,
      primaryColor: true,
      accentColor: true,
      theme: true,
      planTier: true,
    },
    orderBy: [{ parentOrganizationId: "asc" }, { name: "asc" }],
  })
  return organizations.map(organizationSummary)
}

// Creates a brand-new organization plus its first admin user.
async function registerOrganization(req, res, next) {
  try {
    const { organizationName, name, email, password } = req.body
    if (!organizationName || !name || !email || !password) {
      return res.status(400).json({ error: "organizationName, name, email, and password are required" })
    }

    const slug = organizationName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")

    const hashed = await bcrypt.hash(password, 10)

    const rootId = crypto.randomUUID()
    const organization = await prisma.organization.create({
      data: {
        id: rootId,
        name: organizationName,
        slug: `${slug}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: rootId,
        users: {
          create: {
            name,
            email,
            password: hashed,
            role: "ADMIN",
          },
        },
      },
      include: { users: true },
    })

    const admin = organization.users[0]
    const token = signToken({ userId: admin.id, organizationId: organization.id, companyId: organization.companyId, role: admin.role })

    res.status(201).json({
      token,
      user: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
      organization: organizationSummary(organization),
      organizations: [organizationSummary(organization)],
    })
  } catch (err) {
    next(err)
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" })
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { organization: true },
    })

    if (!user || user.organization.archivedAt) {
      return res.status(401).json({ error: "Invalid email or password" })
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" })
    }

    const token = signToken({ userId: user.id, organizationId: user.organizationId, companyId: user.organization.companyId, role: user.role })
    const organizations = ["ADMIN", "CEO"].includes(user.role)
      ? await getCompanyOrganizations(user.organization.companyId)
      : [organizationSummary(user.organization)]

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        canManageAttendance: user.canManageAttendance,
      },
      organization: organizationSummary(user.organization),
      organizations,
    })
  } catch (err) {
    next(err)
  }
}

// Management creates an employee account directly, with the full profile
// filled in up front (contact details, CNIC, DOB, residence, skill, level).
// Only the org owner (ADMIN) may set a role other than EMPLOYEE — that's
// how CEO/Sales Head/HR accounts get created.
async function inviteEmployee(req, res, next) {
  try {
    const {
      name,
      email,
      departmentId,
      managerId,
      phone,
      cnic,
      dob,
      address,
      skill,
      seniorityLevel,
      role,
    } = req.body
    const { organizationId, companyId, role: requesterRole } = req.user

    if (!name || !email) {
      return res.status(400).json({ error: "name and email are required" })
    }

    let assignedRole = "EMPLOYEE"
    if (role !== undefined && role !== "EMPLOYEE") {
      if (!["ADMIN", "CEO"].includes(requesterRole)) {
        return res.status(403).json({ error: "Only the organization owner or a CEO can create management accounts" })
      }
      if (!ASSIGNABLE_ROLES.includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${ASSIGNABLE_ROLES.join(", ")}` })
      }
      if (role === "CEO") {
        const ceoCount = await prisma.user.count({ where: { organization: { companyId }, role: "CEO" } })
        if (ceoCount >= MAX_CEO_COUNT) {
          return res.status(400).json({ error: `An organization can have at most ${MAX_CEO_COUNT} CEOs` })
        }
      }
      assignedRole = role
    }

    if (managerId) {
      const manager = await prisma.user.findFirst({
        where: { id: managerId, organizationId },
        select: { id: true },
      })
      if (!manager) return res.status(400).json({ error: "Reporting Manager must belong to the current organization" })
    }

    const tempPassword = Math.random().toString(36).slice(2, 10)
    const hashed = await bcrypt.hash(tempPassword, 10)

    const employee = await prisma.user.create({
      data: {
        organizationId,
        name,
        email,
        password: hashed,
        departmentId: departmentId || null,
        managerId: managerId || null,
        role: assignedRole,
        phone: phone || null,
        cnic: encryptField(cnic || null),
        dob: dob ? new Date(dob) : null,
        address: address || null,
        skill: skill || null,
        seniorityLevel: seniorityLevel || null,
      },
    })

    // TODO: wire up Nodemailer to actually send `tempPassword` via email.
    res.status(201).json({
      message: "Employee added",
      employee: { id: employee.id, name: employee.name, email: employee.email },
      tempPassword,
    })
  } catch (err) {
    next(err)
  }
}

async function me(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: { organization: true, department: true },
    })
    if (!user) return res.status(404).json({ error: "User not found" })

    const organizations = ["ADMIN", "CEO"].includes(user.role)
      ? await getCompanyOrganizations(user.organization.companyId)
      : [organizationSummary(user.organization)]

    const activeOrganization = organizations.find((org) => org.id === req.user.organizationId) || organizationSummary(user.organization)
    const { password, organization, ...safeUser } = user
    res.json({
      ...safeUser,
      organization: activeOrganization,
      organizations,
    })
  } catch (err) {
    next(err)
  }
}

async function changePassword(req, res, next) {
  try {
    const { userId } = req.user
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword are required" })
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "newPassword must be at least 8 characters" })
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return res.status(404).json({ error: "User not found" })

    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect" })
    }

    const hashed = await bcrypt.hash(newPassword, 10)
    await prisma.user.update({ where: { id: userId }, data: { password: hashed } })

    res.json({ message: "Password updated" })
  } catch (err) {
    next(err)
  }
}

// Management resets a forgotten user's password to a known temporary
// value, since there's no email-based "forgot password" flow — this is
// the admin-assisted equivalent. The employee is expected to change it
// afterward from Profile → Change Password (self-service, already exists).
const TEMP_PASSWORD = "password123"

async function resetPassword(req, res, next) {
  try {
    const { organizationId } = req.user
    const { id } = req.params

    const user = await prisma.user.findFirst({ where: { id, organizationId } })
    if (!user) return res.status(404).json({ error: "Employee not found" })

    const hashed = await bcrypt.hash(TEMP_PASSWORD, 10)
    await prisma.user.update({ where: { id }, data: { password: hashed } })

    logAudit({ organizationId, actorId: req.user.userId, action: "employee.password_reset", targetType: "User", targetId: id, note: `${user.name} <${user.email}>` })
    res.json({ message: "Password reset", tempPassword: TEMP_PASSWORD })
  } catch (err) {
    next(err)
  }
}

module.exports = { registerOrganization, login, inviteEmployee, me, changePassword, resetPassword }
