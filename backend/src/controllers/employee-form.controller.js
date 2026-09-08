const crypto = require("crypto")
const prisma = require("../lib/prisma")
const { encryptField, decryptField } = require("../utils/crypto")
const { logAudit } = require("../utils/audit")

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
    })
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
        fatherName: clean(req.body.fatherName, 120),
        personalEmail,
        phone: clean(req.body.phone, 50),
        address: clean(req.body.address, 500),
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
  listEmployeeForms,
  toggleEmployeeForm,
  getEmployeeFormSubmissions,
  getPublicEmployeeForm,
  submitPublicEmployeeForm,
}
