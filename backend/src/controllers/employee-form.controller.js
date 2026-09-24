const crypto = require("crypto")
const prisma = require("../lib/prisma")
const { encryptField, decryptField } = require("../utils/crypto")
const { logAudit } = require("../utils/audit")
const { notifyUsers } = require("../utils/notifications")

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex")
}

function parseDob(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date
}

function clean(value, max = 500) {
  if (value === undefined || value === null) return null
  return String(value).trim().slice(0, max) || null
}

async function createEmployeeForm(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const title = clean(req.body.title, 120) || "Employee Information Form"
    const days = req.body.expiresInDays === "" || req.body.expiresInDays == null ? 30 : Number(req.body.expiresInDays)
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res.status(400).json({ error: "expiresInDays must be a whole number between 1 and 365" })
    }

    const rawEmployeeIds = Array.isArray(req.body.employeeIds)
      ? req.body.employeeIds
      : req.body.employeeId
        ? [req.body.employeeId]
        : []
    const employeeIds = Array.from(
      new Set(rawEmployeeIds.map((id) => clean(id, 100)).filter(Boolean))
    )
    let recipients = []
    if (employeeIds.length) {
      recipients = await prisma.user.findMany({
        where: { id: { in: employeeIds }, organizationId, status: "ACTIVE" },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      })
      if (recipients.length !== employeeIds.length) {
        return res.status(404).json({ error: "One or more selected employees were not found in your organization" })
      }
    }

    const token = makeToken()
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    const form = await prisma.employeeForm.create({
      data: {
        organizationId,
        createdById: userId,
        title,
        tokenHash: hashToken(token),
        tokenEncrypted: encryptField(token),
        expiresAt,
      },
    })

    logAudit({ organizationId, actorId: userId, action: "employee_form.created", targetType: "EmployeeForm", targetId: form.id, note: title })
    res.status(201).json({
      id: form.id,
      title: form.title,
      active: form.active,
      expiresAt: form.expiresAt,
      token,
      recipients,
      recipient: recipients[0] || null,
    })
  } catch (err) {
    next(err)
  }
}

async function sendEmployeeFormNotifications(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const form = await prisma.employeeForm.findFirst({ where: { id: req.params.id, organizationId } })
    if (!form) return res.status(404).json({ error: "Form not found" })
    if (!form.active) return res.status(400).json({ error: "This form is inactive. Activate it before sending." })

    const rawEmployeeIds = Array.isArray(req.body.employeeIds) ? req.body.employeeIds : []
    const employeeIds = Array.from(
      new Set(rawEmployeeIds.map((id) => clean(id, 100)).filter(Boolean))
    )
    if (!employeeIds.length) return res.status(400).json({ error: "Select at least one employee to notify" })

    const recipients = await prisma.user.findMany({
      where: { id: { in: employeeIds }, organizationId, status: "ACTIVE" },
      select: { id: true, name: true, email: true },
    })
    if (!recipients.length) {
      return res.status(404).json({ error: "None of the selected employees were found in your organization" })
    }

    const token = decryptField(form.tokenEncrypted)
    await notifyUsers({
      organizationId,
      recipientIds: recipients.map((recipient) => recipient.id),
      createdById: userId,
      type: "EMPLOYEE_FORM",
      title: `Please complete: ${form.title}`,
      message: "You've been asked to fill out an employee information form.",
      link: `/employee-form/${token}`,
    })

    logAudit({
      organizationId,
      actorId: userId,
      action: "employee_form.notified",
      targetType: "EmployeeForm",
      targetId: form.id,
      note: `Notified ${recipients.length} employee(s)`,
    })

    res.json({ notified: recipients.length })
  } catch (err) {
    next(err)
  }
}

async function listEmployeeForms(req, res, next) {
  try {
    const forms = await prisma.employeeForm.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { submissions: true } } },
    })
    res.json(forms.map((form) => ({
      id: form.id,
      title: form.title,
      active: form.active,
      expiresAt: form.expiresAt,
      createdAt: form.createdAt,
      submissionCount: form._count.submissions,
      publicToken: decryptField(form.tokenEncrypted),
    })))
  } catch (err) {
    next(err)
  }
}

async function toggleEmployeeForm(req, res, next) {
  try {
    const form = await prisma.employeeForm.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })
    if (!form) return res.status(404).json({ error: "Form not found" })
    const updated = await prisma.employeeForm.update({ where: { id: form.id }, data: { active: !form.active } })
    res.json({ id: updated.id, active: updated.active })
  } catch (err) {
    next(err)
  }
}

async function updateEmployeeForm(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const form = await prisma.employeeForm.findFirst({ where: { id: req.params.id, organizationId } })
    if (!form) return res.status(404).json({ error: "Form not found" })

    const data = {}
    if (req.body.title !== undefined) {
      const title = clean(req.body.title, 120)
      if (!title) return res.status(400).json({ error: "Title is required" })
      data.title = title
    }
    if (req.body.expiresInDays !== undefined && req.body.expiresInDays !== "" && req.body.expiresInDays !== null) {
      const days = Number(req.body.expiresInDays)
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: "expiresInDays must be a whole number between 1 and 365" })
      }
      data.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: "Nothing to update" })

    const updated = await prisma.employeeForm.update({ where: { id: form.id }, data })
    logAudit({ organizationId, actorId: userId, action: "employee_form.updated", targetType: "EmployeeForm", targetId: form.id, note: updated.title })
    res.json({ id: updated.id, title: updated.title, active: updated.active, expiresAt: updated.expiresAt })
  } catch (err) {
    next(err)
  }
}

async function deleteEmployeeForm(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const form = await prisma.employeeForm.findFirst({ where: { id: req.params.id, organizationId } })
    if (!form) return res.status(404).json({ error: "Form not found" })
    await prisma.employeeForm.delete({ where: { id: form.id } })
    logAudit({ organizationId, actorId: userId, action: "employee_form.deleted", targetType: "EmployeeForm", targetId: form.id, note: form.title })
    res.json({ id: form.id, deleted: true })
  } catch (err) {
    next(err)
  }
}

async function deleteEmployeeFormSubmission(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const submission = await prisma.employeeFormSubmission.findFirst({
      where: { id: req.params.submissionId, formId: req.params.id, organizationId },
    })
    if (!submission) return res.status(404).json({ error: "Submission not found" })
    await prisma.employeeFormSubmission.delete({ where: { id: submission.id } })
    logAudit({
      organizationId,
      actorId: userId,
      action: "employee_form_submission.deleted",
      targetType: "EmployeeFormSubmission",
      targetId: submission.id,
      note: submission.name,
    })
    res.json({ id: submission.id, deleted: true })
  } catch (err) {
    next(err)
  }
}

async function getEmployeeFormSubmissions(req, res, next) {
  try {
    const form = await prisma.employeeForm.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })
    if (!form) return res.status(404).json({ error: "Form not found" })
    const submissions = await prisma.employeeFormSubmission.findMany({
      where: { formId: form.id, organizationId: req.user.organizationId },
      orderBy: { submittedAt: "desc" },
    })
    res.json(submissions.map((s) => ({
      ...s,
      cnic: decryptField(s.cnic),
      fatherName: decryptField(s.fatherName),
      personalEmail: decryptField(s.personalEmail),
      phone: decryptField(s.phone),
      address: decryptField(s.address),
    })))
  } catch (err) {
    next(err)
  }
}

async function getPublicEmployeeForm(req, res, next) {
  try {
    const tokenHash = hashToken(req.params.token)
    const form = await prisma.employeeForm.findUnique({ where: { tokenHash }, select: { id: true, title: true, active: true, expiresAt: true } })
    if (!form || !form.active || (form.expiresAt && form.expiresAt < new Date())) {
      return res.status(404).json({ error: "This employee form is no longer available" })
    }
    res.json({ id: form.id, title: form.title, expiresAt: form.expiresAt })
  } catch (err) {
    next(err)
  }
}

async function submitPublicEmployeeForm(req, res, next) {
  try {
    const tokenHash = hashToken(req.params.token)
    const form = await prisma.employeeForm.findUnique({ where: { tokenHash }, select: { id: true, organizationId: true, active: true, expiresAt: true } })
    if (!form || !form.active || (form.expiresAt && form.expiresAt < new Date())) {
      return res.status(404).json({ error: "This employee form is no longer available" })
    }

    const name = clean(req.body.name, 120)
    if (!name) return res.status(400).json({ error: "Full name is required" })

    const personalEmail = clean(req.body.personalEmail, 180)
    const companyEmail = clean(req.body.companyEmail, 180)
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (personalEmail && !emailPattern.test(personalEmail)) return res.status(400).json({ error: "Invalid personal email" })
    if (companyEmail && !emailPattern.test(companyEmail)) return res.status(400).json({ error: "Invalid company email" })

    const cnic = clean(req.body.cnic, 40)
    if (cnic && !/^\d{5}-\d{7}-\d$/.test(cnic)) return res.status(400).json({ error: "CNIC must use XXXXX-XXXXXXX-X format" })

    const linkedinUrl = clean(req.body.linkedinUrl, 500)
    if (linkedinUrl) {
      try {
        const parsed = new URL(linkedinUrl)
        if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname.toLowerCase().includes("linkedin.com")) throw new Error()
      } catch {
        return res.status(400).json({ error: "LinkedIn must be a valid LinkedIn URL" })
      }
    }

    const dob = parseDob(req.body.dob)
    if (req.body.dob && dob === undefined) return res.status(400).json({ error: "Invalid date of birth" })

    const seniorityLevel = clean(req.body.seniorityLevel, 20)?.toUpperCase() || null
    if (seniorityLevel && !["INTERN", "JUNIOR"].includes(seniorityLevel)) {
      return res.status(400).json({ error: "Employee type must be Intern or Junior" })
    }

    const submission = await prisma.employeeFormSubmission.create({
      data: {
        formId: form.id,
        organizationId: form.organizationId,
        name,
        fatherName: encryptField(clean(req.body.fatherName, 120)),
        personalEmail: encryptField(personalEmail),
        phone: encryptField(clean(req.body.phone, 50)),
        address: encryptField(clean(req.body.address, 500)),
        cnic: encryptField(cnic),
        dob,
        education: clean(req.body.education, 180),
        currentUniversity: clean(req.body.currentUniversity, 180),
        seniorityLevel,
        companyEmail,
        linkedinUrl,
        notes: clean(req.body.notes, 1000),
      },
    })

    res.status(201).json({ message: "Your information has been submitted successfully", submissionId: submission.id })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  createEmployeeForm,
  sendEmployeeFormNotifications,
  listEmployeeForms,
  toggleEmployeeForm,
  updateEmployeeForm,
  deleteEmployeeForm,
  getEmployeeFormSubmissions,
  deleteEmployeeFormSubmission,
  getPublicEmployeeForm,
  submitPublicEmployeeForm,
}
