const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES } = require("../utils/roles")

function parseDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date
}

async function addCertification(req, res, next) {
  try {
    const isManagement = MANAGEMENT_ROLES.includes(req.user?.role) && ["ADMIN", "CEO"].includes(req.user.role)
    const isSelf = req.user?.userId === req.params.id
    if (!isManagement && !isSelf) {
      return res.status(403).json({ error: "Only the employee or an ADMIN/CEO can manage certifications" })
    }

    const { id: employeeId } = req.params
    const { organizationId } = req.user
    const { name, institute, credentialId, credentialUrl, issuedDate, expiryDate, notes } = req.body

    if (!name?.trim() || !institute?.trim()) {
      return res.status(400).json({ error: "Certificate name and institute are required" })
    }
    if (credentialUrl?.trim()) {
      try {
        const url = new URL(credentialUrl.trim())
        if (!["http:", "https:"].includes(url.protocol)) throw new Error()
      } catch {
        return res.status(400).json({ error: "Verification URL must be a valid http or https URL" })
      }
    }

    const employee = await prisma.user.findFirst({ where: { id: employeeId, organizationId }, select: { id: true } })
    if (!employee) return res.status(404).json({ error: "Employee not found" })

    const issued = parseDate(issuedDate)
    const expiry = parseDate(expiryDate)
    if (issuedDate && issued === undefined) return res.status(400).json({ error: "Invalid issued date" })
    if (expiryDate && expiry === undefined) return res.status(400).json({ error: "Invalid expiry date" })
    if (issued && expiry && expiry < issued) return res.status(400).json({ error: "Expiry date cannot be before issued date" })

    const certification = await prisma.certification.create({
      data: {
        employeeId,
        name: name.trim(),
        institute: institute.trim(),
        credentialId: credentialId?.trim() || null,
        credentialUrl: credentialUrl?.trim() || null,
        issuedDate: issued,
        expiryDate: expiry,
        notes: notes?.trim() || null,
      },
    })

    res.status(201).json(certification)
  } catch (err) {
    next(err)
  }
}

async function updateCertification(req, res, next) {
  try {
    const isManagement = MANAGEMENT_ROLES.includes(req.user?.role) && ["ADMIN", "CEO"].includes(req.user.role)
    const isSelf = req.user?.userId === req.params.id
    if (!isManagement && !isSelf) {
      return res.status(403).json({ error: "Only the employee or an ADMIN/CEO can manage certifications" })
    }

    const { id: employeeId, certificationId } = req.params
    const { organizationId } = req.user
    const existing = await prisma.certification.findFirst({
      where: { id: certificationId, employeeId, employee: { organizationId } },
    })
    if (!existing) return res.status(404).json({ error: "Certification not found" })

    const { name, institute, credentialId, credentialUrl, issuedDate, expiryDate, notes } = req.body
    if (!name?.trim() || !institute?.trim()) {
      return res.status(400).json({ error: "Certificate name and institute are required" })
    }
    if (credentialUrl?.trim()) {
      try {
        const url = new URL(credentialUrl.trim())
        if (!["http:", "https:"].includes(url.protocol)) throw new Error()
      } catch {
        return res.status(400).json({ error: "Verification URL must be a valid http or https URL" })
      }
    }
    const issued = parseDate(issuedDate)
    const expiry = parseDate(expiryDate)
    if (issuedDate && issued === undefined) return res.status(400).json({ error: "Invalid issued date" })
    if (expiryDate && expiry === undefined) return res.status(400).json({ error: "Invalid expiry date" })
    if (issued && expiry && expiry < issued) return res.status(400).json({ error: "Expiry date cannot be before issued date" })

    const certification = await prisma.certification.update({
      where: { id: certificationId },
      data: {
        name: name.trim(),
        institute: institute.trim(),
        credentialId: credentialId?.trim() || null,
        credentialUrl: credentialUrl?.trim() || null,
        issuedDate: issued,
        expiryDate: expiry,
        notes: notes?.trim() || null,
      },
    })
    res.json(certification)
  } catch (err) {
    next(err)
  }
}

async function deleteCertification(req, res, next) {
  try {
    const isManagement = MANAGEMENT_ROLES.includes(req.user?.role) && ["ADMIN", "CEO"].includes(req.user.role)
    const isSelf = req.user?.userId === req.params.id
    if (!isManagement && !isSelf) {
      return res.status(403).json({ error: "Only the employee or an ADMIN/CEO can manage certifications" })
    }
    const { id: employeeId, certificationId } = req.params
    const { organizationId } = req.user
    const existing = await prisma.certification.findFirst({
      where: { id: certificationId, employeeId, employee: { organizationId } },
      select: { id: true },
    })
    if (!existing) return res.status(404).json({ error: "Certification not found" })
    await prisma.certification.delete({ where: { id: certificationId } })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

module.exports = { addCertification, updateCertification, deleteCertification }
