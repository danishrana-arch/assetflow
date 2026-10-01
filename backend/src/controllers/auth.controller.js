const bcrypt = require("bcrypt")
const crypto = require("crypto")
const prisma = require("../lib/prisma")
const { signToken } = require("../utils/jwt")
const { ASSIGNABLE_ROLES, MAX_CEO_COUNT } = require("../utils/roles")
const { encryptField } = require("../utils/crypto")
const { logAudit } = require("../utils/audit")
const { isValidTimeZone } = require("../utils/timezone")
const { sendEmail, appUrl, escapeHtml } = require("../utils/mailer")
const { createNotification } = require("../utils/notifications")

// Failed-login alerting: after MAX_FAILED_LOGINS wrong passwords within
// FAILED_LOGIN_WINDOW_MS, the account owner is emailed (and gets an in-app
// notification) that someone may be trying to access their account — at
// most once per ALERT_COOLDOWN_MS so a sustained attack doesn't flood them.
const MAX_FAILED_LOGINS = 4
const FAILED_LOGIN_WINDOW_MS = 30 * 60 * 1000
const ALERT_COOLDOWN_MS = 60 * 60 * 1000
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000

const hashToken = (raw) => crypto.createHash("sha256").update(raw).digest("hex")

async function sendFailedLoginAlert(user, { attempts, ip, userAgent }) {
  const when = new Date().toUTCString()
  const resetLink = `${appUrl()}/forgot-password`
  await createNotification({
    organizationId: user.organizationId,
    recipientId: user.id,
    type: "SECURITY",
    title: "Multiple failed sign-in attempts",
    message: `${attempts} wrong-password attempts on your account (last at ${when}${ip ? ` from ${ip}` : ""}). If this wasn't you, change your password.`,
    link: "/profile",
  }).catch(() => {})

  return sendEmail({
    to: user.email,
    subject: "Someone is trying to access your ManagementDock account",
    text:
      `Hi ${user.name},\n\nWe noticed ${attempts} failed sign-in attempts on your ManagementDock account (${user.email}).\n` +
      `Time: ${when}\n${ip ? `IP address: ${ip}\n` : ""}${userAgent ? `Device: ${userAgent}\n` : ""}\n` +
      `If this was you, you can reset your password here: ${resetLink}\n` +
      `If this wasn't you, we recommend resetting your password right away. Your account has not been changed.\n`,
    html:
      `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937;line-height:1.6">` +
      `<h2>Someone is trying to access your account</h2>` +
      `<p>Hi ${escapeHtml(user.name)},</p>` +
      `<p>We noticed <strong>${attempts} failed sign-in attempts</strong> on your ManagementDock account (${escapeHtml(user.email)}).</p>` +
      `<p><strong>Time:</strong> ${escapeHtml(when)}${ip ? `<br><strong>IP address:</strong> ${escapeHtml(ip)}` : ""}${userAgent ? `<br><strong>Device:</strong> ${escapeHtml(userAgent)}` : ""}</p>` +
      `<p>If this wasn't you, we recommend resetting your password right away. Your account has not been changed.</p>` +
      `<p><a href="${resetLink}" style="display:inline-block;background:#111827;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Reset my password</a></p>` +
      `</div>`,
  })
}


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
    timezone: organization.timezone || "Asia/Karachi",
  }
}

// CEO can always see every organization in the company. A main-company
// ADMIN or a main-company IT_MANAGER gets the same company-wide list, but
// only when their own home organization *is* the main company — a
// sub-organization's ADMIN or IT_MANAGER stays locked to their own org
// (see applyOrganizationScope in auth.middleware.js, which is the actual
// enforcement point — this just decides what the org-switcher shows, and
// must stay in sync with it: an ADMIN/IT_MANAGER outside the main company
// who could see other orgs here but not switch into them would just hit a
// 403 after picking one).
function canSeeCompanyOrganizations(user) {
  if (user.role === "CEO") return true
  if (["ADMIN", "IT_MANAGER"].includes(user.role)) {
    return user.organization.id === user.organization.companyId
  }
  return false
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
      timezone: true,
    },
    orderBy: [{ parentOrganizationId: "asc" }, { name: "asc" }],
  })
  return organizations.map(organizationSummary)
}

// Creates a brand-new organization plus its first admin user.
async function registerOrganization(req, res, next) {
  try {
    const { organizationName, name, email, password, timezone } = req.body
    if (!organizationName || !name || !email || !password) {
      return res.status(400).json({ error: "organizationName, name, email, and password are required" })
    }

    const selectedTimeZone = timezone && isValidTimeZone(String(timezone)) ? String(timezone) : "Asia/Karachi"

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
        timezone: selectedTimeZone,
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
      const now = new Date()
      const withinWindow = user.lastFailedLoginAt && now - user.lastFailedLoginAt < FAILED_LOGIN_WINDOW_MS
      const attempts = (withinWindow ? user.failedLoginAttempts : 0) + 1
      const shouldAlert =
        attempts >= MAX_FAILED_LOGINS &&
        (!user.securityAlertSentAt || now - user.securityAlertSentAt > ALERT_COOLDOWN_MS)

      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: attempts, lastFailedLoginAt: now, ...(shouldAlert ? { securityAlertSentAt: now } : {}) },
      })

      if (shouldAlert) {
        // Fire-and-forget: don't make the response slower (or its timing
        // reveal anything) while SMTP runs.
        sendFailedLoginAlert(user, { attempts, ip: req.ip, userAgent: req.get("user-agent") })
          .then((sent) => { if (!sent) console.warn(`Failed-login alert for ${user.email}: SMTP not configured, in-app notification only`) })
          .catch((e) => console.error(`Failed-login alert email for ${user.email} failed:`, e.message))
        logAudit({ organizationId: user.organizationId, actorId: null, action: "auth.failed_login_alert", targetType: "User", targetId: user.id, note: `${attempts} failed attempts${req.ip ? ` from ${req.ip}` : ""}` })
      }

      // Same message whether or not the email exists — the frontend counts
      // failures itself to decide when to offer "Forgot password?".
      return res.status(401).json({ error: "Invalid email or password" })
    }

    if (user.failedLoginAttempts || user.lastFailedLoginAt) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lastFailedLoginAt: null } })
    }

    const token = signToken({ userId: user.id, organizationId: user.organizationId, companyId: user.organization.companyId, role: user.role })
    const organizations = canSeeCompanyOrganizations(user)
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
// Only Admin may set a role other than EMPLOYEE — that's
// how CEO/Sales Head/HR accounts get created.
async function inviteEmployee(req, res, next) {
  try {
    const {
      name,
      email,
      departmentId,
      managerId,
      phone,
      personalEmail,
      fatherName,
      education,
      currentUniversity,
      linkedinUrl,
      shiftStart,
      shiftEnd,
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
      // HR may create any non-owner role; ADMIN/CEO accounts stay
      // ADMIN/CEO-only (same rule as updateEmployee).
      const hrCanAssign = requesterRole === "HR" && !["ADMIN", "CEO"].includes(role)
      if (!["ADMIN", "CEO"].includes(requesterRole) && !hrCanAssign) {
        return res.status(403).json({ error: requesterRole === "HR" ? "HR can't create Admin or CEO accounts" : "Only Admin, CEO or HR can create management accounts" })
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
        where: {
          id: managerId,
          OR: [
            { organizationId },
            { organizationId: companyId, role: "CEO" },
          ],
        },
        select: { id: true },
      })
      if (!manager) return res.status(400).json({ error: "Reporting Manager must belong to the current organization or be the company CEO" })
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
        phone: encryptField(phone || null),
        personalEmail: encryptField(personalEmail || null),
        fatherName: encryptField(fatherName || null),
        education: education || null,
        currentUniversity: currentUniversity || null,
        linkedinUrl: linkedinUrl || null,
        shiftStart: shiftStart || null,
        shiftEnd: shiftEnd || null,
        cnic: encryptField(cnic || null),
        dob: dob ? new Date(dob) : null,
        address: encryptField(address || null),
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

    const organizations = canSeeCompanyOrganizations(user)
      ? await getCompanyOrganizations(user.organization.companyId)
      : [organizationSummary(user.organization)]

    const activeOrganization = organizations.find((org) => org.id === req.user.organizationId) || organizationSummary(user.organization)
    const { password, organization, calendarFeedToken, ...safeUser } = user
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

    // HR can reset anyone's password except an ADMIN's or CEO's — that's
    // reserved for ADMIN/CEO resetting each other.
    if (req.user.role === "HR" && ["ADMIN", "CEO"].includes(user.role)) {
      return res.status(403).json({ error: "HR cannot reset an Admin or CEO's password" })
    }

    const hashed = await bcrypt.hash(TEMP_PASSWORD, 10)
    await prisma.user.update({ where: { id }, data: { password: hashed } })

    logAudit({ organizationId, actorId: req.user.userId, action: "employee.password_reset", targetType: "User", targetId: id, note: `${user.name} <${user.email}>` })
    res.json({ message: "Password reset", tempPassword: TEMP_PASSWORD })
  } catch (err) {
    next(err)
  }
}

// Public "forgot password": emails a one-time reset link. Always answers
// with the same generic message so it can't be used to discover which
// emails have accounts.
async function forgotPassword(req, res, next) {
  try {
    const email = String(req.body?.email || "").trim()
    if (!email) return res.status(400).json({ error: "Email is required" })
    const generic = { message: "If an account exists for that email, a password reset link has been sent." }

    const user = await prisma.user.findUnique({ where: { email }, include: { organization: true } })
    if (!user || user.status === "LEFT_COMPANY" || user.organization.archivedAt) return res.json(generic)

    const raw = crypto.randomBytes(32).toString("hex")
    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
      prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
      }),
    ])

    const link = `${appUrl()}/reset-password?token=${raw}`
    let sent = false
    try {
      sent = await sendEmail({
        to: user.email,
        subject: "Reset your ManagementDock password",
        text: `Hi ${user.name},\n\nUse this link to set a new password (valid for 1 hour):\n${link}\n\nIf you didn't ask for this, you can ignore this email — your password won't change.\n`,
        html:
          `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937;line-height:1.6">` +
          `<h2>Reset your password</h2><p>Hi ${escapeHtml(user.name)},</p>` +
          `<p>Click the button below to set a new password. This link is valid for 1 hour and can be used once.</p>` +
          `<p><a href="${link}" style="display:inline-block;background:#111827;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Set a new password</a></p>` +
          `<p style="color:#6b7280;font-size:13px">If you didn't ask for this, you can ignore this email — your password won't change.</p></div>`,
      })
    } catch (e) {
      console.error(`Password reset email for ${user.email} failed:`, e.message)
    }
    if (!sent && process.env.NODE_ENV !== "production") {
      console.warn(`[dev] SMTP not configured — password reset link for ${user.email}: ${link}`)
    }

    logAudit({ organizationId: user.organizationId, actorId: null, action: "auth.password_reset_requested", targetType: "User", targetId: user.id, note: sent ? "email sent" : "email not sent (SMTP not configured)" })
    res.json(generic)
  } catch (err) {
    next(err)
  }
}

// Completes the reset from the emailed link.
async function resetPasswordWithToken(req, res, next) {
  try {
    const { token, password } = req.body || {}
    if (!token || !password) return res.status(400).json({ error: "token and password are required" })
    if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" })

    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(String(token)) }, include: { user: true } })
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." })
    }

    const hashed = await bcrypt.hash(String(password), 10)
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { password: hashed, failedLoginAttempts: 0, lastFailedLoginAt: null } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.passwordResetToken.deleteMany({ where: { userId: record.userId, usedAt: null } }),
    ])

    logAudit({ organizationId: record.user.organizationId, actorId: record.userId, action: "auth.password_reset_completed", targetType: "User", targetId: record.userId, note: "via emailed reset link" })
    res.json({ message: "Your password has been updated. You can now sign in." })
  } catch (err) {
    next(err)
  }
}

module.exports = { registerOrganization, login, inviteEmployee, me, changePassword, resetPassword, forgotPassword, resetPasswordWithToken }
