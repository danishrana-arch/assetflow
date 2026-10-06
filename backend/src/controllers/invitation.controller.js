const bcrypt = require("bcrypt")
const crypto = require("crypto")
const prisma = require("../lib/prisma")
const { ASSIGNABLE_ROLES, MAX_CEO_COUNT } = require("../utils/roles")
const { parseDateInput, employmentData, EMPLOYMENT_STATUSES } = require("../utils/employee-fields")
const { sendEmail, appUrl, escapeHtml } = require("../utils/mailer")
const { logAudit } = require("../utils/audit")
const { sessionResponse } = require("./auth.controller")

// Email invitations for new employees (Employee Forms → "Invite new
// employee"). The account is created up front with the role / department /
// manager the inviter picked, plus a random password nobody knows. The
// emailed one-time link (valid INVITE_TTL_DAYS) lets the person choose their
// own password and signs them straight in to their profile. Only a SHA-256
// hash of the link token is stored (UserInvitation.tokenHash).

const INVITE_TTL_DAYS = 7
const OWNER_ROLES = ["ADMIN", "CEO"]
const ROLE_LABELS = {
  CEO: "CEO",
  ADMIN: "Admin",
  HR: "HR",
  MANAGEMENT: "Management",
  DEPARTMENT_HEAD: "Department Head",
  IT_MANAGER: "IT Manager",
  SITE_ADMIN: "Site Admin / Project Manager",
  EMPLOYEE: "Employee",
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const hashToken = (raw) => crypto.createHash("sha256").update(raw).digest("hex")
const newToken = () => {
  const raw = crypto.randomBytes(32).toString("hex")
  return { raw, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000) }
}
const inviteLink = (raw) => `${appUrl()}/accept-invite?token=${raw}`
const clean = (value, max = 200) => {
  const s = value == null ? "" : String(value).trim()
  return s ? s.slice(0, max) : null
}

function invitationStatus(inv) {
  if (inv.acceptedAt) return "ACCEPTED"
  if (inv.expiresAt < new Date()) return "EXPIRED"
  return "PENDING"
}

const INVITATION_INCLUDE = {
  user: { select: { id: true, name: true, email: true, role: true, designation: true, department: { select: { name: true } } } },
  invitedBy: { select: { id: true, name: true } },
}

function serialize(inv) {
  return {
    id: inv.id,
    status: invitationStatus(inv),
    employee: {
      id: inv.user.id,
      name: inv.user.name,
      email: inv.user.email,
      role: inv.user.role,
      designation: inv.user.designation,
      department: inv.user.department?.name || null,
    },
    invitedBy: inv.invitedBy ? { id: inv.invitedBy.id, name: inv.invitedBy.name } : null,
    message: inv.message,
    createdAt: inv.createdAt,
    lastSentAt: inv.lastSentAt,
    sendCount: inv.sendCount,
    expiresAt: inv.expiresAt,
    acceptedAt: inv.acceptedAt,
  }
}

// Presented as coming from the company that sent it — its name only (no
// inviter's name, no product branding), including the sender display name.
async function sendInvitationEmail({ user, organizationName, departmentName, message, raw }) {
  const link = inviteLink(raw)
  const role = ROLE_LABELS[user.role] || user.role
  const details = [
    ["Company", organizationName],
    ["Role", role],
    user.designation && ["Designation", user.designation],
    departmentName && ["Department", departmentName],
    ["Sign-in email", user.email],
  ].filter(Boolean)

  let sent = false
  try {
    sent = await sendEmail({
      to: user.email,
      fromName: organizationName,
      subject: `You're invited to join ${organizationName}`,
      text:
        `Hi ${user.name},\n\n${organizationName} has invited you to join the team.\n\n` +
        details.map(([k, v]) => `${k}: ${v}`).join("\n") +
        (message ? `\n\nMessage from ${organizationName}:\n${message}` : "") +
        `\n\nAccept the invitation and set your password here (valid for ${INVITE_TTL_DAYS} days, one use):\n${link}\n\n` +
        `If you weren't expecting this, you can ignore this email.\n`,
      html:
        `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937;line-height:1.6">` +
        `<h2>You're invited to join ${escapeHtml(organizationName)}</h2>` +
        `<p>Hi ${escapeHtml(user.name)},</p>` +
        `<p><strong>${escapeHtml(organizationName)}</strong> has invited you to join the team.</p>` +
        `<table style="border-collapse:collapse;margin:12px 0">` +
        details.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#6b7280">${escapeHtml(k)}</td><td style="padding:4px 0"><strong>${escapeHtml(v)}</strong></td></tr>`).join("") +
        `</table>` +
        (message ? `<p style="background:#f3f4f6;border-radius:12px;padding:12px 14px;white-space:pre-line"><em>${escapeHtml(message)}</em><br><span style="color:#6b7280;font-size:13px">— ${escapeHtml(organizationName)}</span></p>` : "") +
        `<p><a href="${link}" style="display:inline-block;background:#111827;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Accept invitation</a></p>` +
        `<p style="color:#6b7280;font-size:13px">You'll choose your own password, then go straight to your profile. This link is valid for ${INVITE_TTL_DAYS} days and can be used once. If you weren't expecting this, you can ignore this email.</p>` +
        `</div>`,
    })
  } catch (e) {
    console.error(`Invitation email for ${user.email} failed:`, e.message)
  }
  if (!sent && process.env.NODE_ENV !== "production") {
    console.warn(`[dev] Invitation email not sent (SMTP not configured?) — link for ${user.email}: ${link}`)
  }
  return { sent, link }
}

async function emailContext(organizationId, departmentId) {
  const [organization, department] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    departmentId ? prisma.department.findUnique({ where: { id: departmentId }, select: { name: true } }) : null,
  ])
  return { organizationName: organization?.name || "your company", departmentName: department?.name || null }
}

// POST /invitations — ADMIN/CEO/HR. Creates the account + invitation and
// emails the link. The link is also returned so it can be shared another way
// (e.g. when SMTP isn't configured).
async function createInvitation(req, res, next) {
  try {
    const { organizationId, companyId, userId: inviterId, role: requesterRole } = req.user
    const name = clean(req.body.name, 120)
    const email = clean(req.body.email, 200)?.toLowerCase()
    const role = req.body.role || "EMPLOYEE"
    const designation = clean(req.body.designation, 120)
    const message = clean(req.body.message, 1000)
    const departmentId = req.body.departmentId || null
    const managerId = req.body.managerId || null

    if (!name) return res.status(400).json({ error: "Name is required" })
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "A valid email address is required" })
    if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${ASSIGNABLE_ROLES.join(", ")}` })
    // Same rule as adding an employee: HR may invite any non-owner role;
    // Admin/CEO accounts only by Admin/CEO.
    if (OWNER_ROLES.includes(role) && !OWNER_ROLES.includes(requesterRole)) {
      return res.status(403).json({ error: "Only an Admin or CEO can invite an Admin or CEO" })
    }
    if (role === "CEO") {
      const ceoCount = await prisma.user.count({ where: { organization: { companyId }, role: "CEO" } })
      if (ceoCount >= MAX_CEO_COUNT) return res.status(400).json({ error: `An organization can have at most ${MAX_CEO_COUNT} CEOs` })
    }

    const joiningDate = parseDateInput(req.body.joiningDate)
    if (joiningDate === undefined) return res.status(400).json({ error: "Joining date must be a valid date" })
    const employmentStatus = req.body.employmentStatus || "PROBATION"
    if (!EMPLOYMENT_STATUSES.includes(employmentStatus)) {
      return res.status(400).json({ error: `Employment status must be one of: ${EMPLOYMENT_STATUSES.join(", ")}` })
    }

    if (departmentId) {
      const department = await prisma.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true } })
      if (!department) return res.status(400).json({ error: "Department not found in this organization" })
    }
    if (managerId) {
      const manager = await prisma.user.findFirst({
        where: { id: managerId, OR: [{ organizationId }, { organizationId: companyId, role: "CEO" }] },
        select: { id: true },
      })
      if (!manager) return res.status(400).json({ error: "Reporting Manager must belong to the current organization or be the company CEO" })
    }

    // User.email is globally unique — check case-insensitively so "Ali@x.com"
    // and "ali@x.com" can't both exist.
    const existing = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, organizationId: true, invitation: { select: { acceptedAt: true } } },
    })
    if (existing) {
      const pendingHere = existing.organizationId === organizationId && existing.invitation && !existing.invitation.acceptedAt
      return res.status(409).json({
        error: pendingHere
          ? "This person has already been invited — use Resend in the invitations list."
          : "An account with this email already exists.",
      })
    }

    const { raw, tokenHash, expiresAt } = newToken()
    // Random password nobody knows; replaced when the invitation is accepted.
    const placeholderPassword = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10)

    const user = await prisma.user.create({
      data: {
        organizationId,
        name,
        email,
        password: placeholderPassword,
        role,
        designation,
        departmentId,
        managerId,
        joiningDate,
        ...employmentData({ employmentStatus, permanentDate: null }),
        invitation: { create: { organizationId, invitedById: inviterId, tokenHash, expiresAt, message } },
      },
      include: { invitation: { include: INVITATION_INCLUDE } },
    })

    const ctx = await emailContext(organizationId, departmentId)
    const { sent, link } = await sendInvitationEmail({ user, ...ctx, message, raw })

    logAudit({ organizationId, actorId: inviterId, action: "employee.invited", targetType: "User", targetId: user.id, note: `${name} <${email}> as ${role}${sent ? "" : " (email not sent)"}` })
    res.status(201).json({ invitation: serialize(user.invitation), emailSent: sent, link })
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "An account with this email already exists." })
    next(err)
  }
}

// GET /invitations — invitations of the current organization, newest first.
async function listInvitations(req, res, next) {
  try {
    const invitations = await prisma.userInvitation.findMany({
      where: { organizationId: req.user.organizationId },
      include: INVITATION_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 200,
    })
    res.json(invitations.map(serialize))
  } catch (err) {
    next(err)
  }
}

async function findManageable(req, res) {
  const inv = await prisma.userInvitation.findFirst({
    where: { id: req.params.id, organizationId: req.user.organizationId },
    include: INVITATION_INCLUDE,
  })
  if (!inv) {
    res.status(404).json({ error: "Invitation not found" })
    return null
  }
  if (OWNER_ROLES.includes(inv.user.role) && !OWNER_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Only an Admin or CEO can manage an Admin or CEO invitation" })
    return null
  }
  if (inv.acceptedAt) {
    res.status(400).json({ error: "This invitation has already been accepted" })
    return null
  }
  return inv
}

// POST /invitations/:id/resend — new link (the old one stops working), new
// expiry, email sent again.
async function resendInvitation(req, res, next) {
  try {
    const inv = await findManageable(req, res)
    if (!inv) return
    const { raw, tokenHash, expiresAt } = newToken()
    const updated = await prisma.userInvitation.update({
      where: { id: inv.id },
      data: { tokenHash, expiresAt, lastSentAt: new Date(), sendCount: { increment: 1 } },
      include: INVITATION_INCLUDE,
    })
    const user = await prisma.user.findUnique({ where: { id: inv.userId }, select: { name: true, email: true, role: true, designation: true, departmentId: true } })
    const ctx = await emailContext(inv.organizationId, user.departmentId)
    const { sent, link } = await sendInvitationEmail({ user, ...ctx, message: inv.message, raw })

    logAudit({ organizationId: req.user.organizationId, actorId: req.user.userId, action: "employee.invitation_resent", targetType: "User", targetId: inv.userId, note: `${user.email}${sent ? "" : " (email not sent)"}` })
    res.json({ invitation: serialize(updated), emailSent: sent, link })
  } catch (err) {
    next(err)
  }
}

// DELETE /invitations/:id — cancels a not-yet-accepted invitation. The
// account was never used, so it is removed (frees the email for re-use).
async function cancelInvitation(req, res, next) {
  try {
    const inv = await findManageable(req, res)
    if (!inv) return
    await prisma.user.delete({ where: { id: inv.userId } })
    logAudit({ organizationId: req.user.organizationId, actorId: req.user.userId, action: "employee.invitation_cancelled", targetType: "User", targetId: inv.userId, note: `${inv.user.name} <${inv.user.email}>` })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}

// ---- Public (no login): the page the emailed link opens. ----

async function findByToken(token) {
  if (!token) return null
  return prisma.userInvitation.findUnique({
    where: { tokenHash: hashToken(String(token)) },
    include: {
      user: { select: { id: true, name: true, email: true, role: true, designation: true, status: true, department: { select: { name: true } } } },
      organization: { select: { name: true, archivedAt: true } },
    },
  })
}

function tokenProblem(inv) {
  if (!inv || inv.organization.archivedAt || inv.user.status === "LEFT_COMPANY") return { status: 400, error: "This invitation link is invalid. Ask HR to send you a new one." }
  if (inv.acceptedAt) return { status: 410, error: "This invitation has already been accepted. Sign in with your email and password.", accepted: true }
  if (inv.expiresAt < new Date()) return { status: 410, error: "This invitation has expired. Ask HR to resend it." }
  return null
}

// GET /auth/invitation/:token
async function getInvitationByToken(req, res, next) {
  try {
    const inv = await findByToken(req.params.token)
    const problem = tokenProblem(inv)
    if (problem) return res.status(problem.status).json({ error: problem.error, accepted: !!problem.accepted })
    res.json({
      name: inv.user.name,
      email: inv.user.email,
      role: inv.user.role,
      roleLabel: ROLE_LABELS[inv.user.role] || inv.user.role,
      designation: inv.user.designation,
      department: inv.user.department?.name || null,
      organizationName: inv.organization.name,
      message: inv.message,
      expiresAt: inv.expiresAt,
    })
  } catch (err) {
    next(err)
  }
}

// POST /auth/accept-invitation { token, password, name?, phone? } — sets the
// password, marks the invitation accepted and returns a normal login session.
async function acceptInvitation(req, res, next) {
  try {
    const { token, password } = req.body || {}
    if (!token || !password) return res.status(400).json({ error: "token and password are required" })
    if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" })

    const inv = await findByToken(token)
    const problem = tokenProblem(inv)
    if (problem) return res.status(problem.status).json({ error: problem.error, accepted: !!problem.accepted })

    const name = clean(req.body.name, 120)
    const hashed = await bcrypt.hash(String(password), 10)
    // Guard against a double submit: only one request can flip acceptedAt.
    const claimed = await prisma.userInvitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } })
    if (!claimed.count) return res.status(410).json({ error: "This invitation has already been accepted. Sign in with your email and password.", accepted: true })

    const user = await prisma.user.update({
      where: { id: inv.userId },
      data: { password: hashed, failedLoginAttempts: 0, lastFailedLoginAt: null, ...(name ? { name } : {}) },
      include: { organization: true },
    })

    logAudit({ organizationId: inv.organizationId, actorId: user.id, action: "employee.invitation_accepted", targetType: "User", targetId: user.id, note: user.email })
    res.json(await sessionResponse(user))
  } catch (err) {
    next(err)
  }
}

module.exports = { createInvitation, listInvitations, resendInvitation, cancelInvitation, getInvitationByToken, acceptInvitation }
