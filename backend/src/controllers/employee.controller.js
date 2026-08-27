const bcrypt = require("bcrypt")
const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES, ASSIGNABLE_ROLES, MAX_CEO_COUNT } = require("../utils/roles")
const { encryptField, decryptField } = require("../utils/crypto")
const { logAudit } = require("../utils/audit")
const { parseCsv } = require("../utils/csv")

function stripSensitive(user, canSeeSensitive) {
  const { password, cnic, bankAccountNumber, ...rest } = user
  if (!canSeeSensitive) return rest
  return { ...rest, cnic: decryptField(cnic), bankAccountNumber: decryptField(bankAccountNumber) }
}

async function listEmployees(req, res, next) {
  try {
    const { organizationId } = req.user
    const { search, department, status, page, pageSize } = req.query

    const where = {
      organizationId,
      ...(department ? { departmentId: department } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    }

    if (page) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1)
      const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 25))

      const [total, employees, ceoCount] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          include: { department: true, assignedAssets: true },
          orderBy: { name: "asc" },
          skip: (pageNum - 1) * size,
          take: size,
        }),
        prisma.user.count({ where: { organizationId, role: "CEO" } }),
      ])

      return res.json({
        data: employees.map(({ password, cnic, bankAccountNumber, ...e }) => e),
        page: pageNum,
        pageSize: size,
        total,
        totalPages: Math.max(1, Math.ceil(total / size)),
        ceoCount,
      })
    }

    const employees = await prisma.user.findMany({
      where,
      include: { department: true, assignedAssets: true },
      orderBy: { name: "asc" },
    })

    // List views never include CNIC — only the single-employee view does,
    // and even then only for the employee themselves or management.
    res.json(employees.map(({ password, cnic, bankAccountNumber, ...e }) => e))
  } catch (err) {
    next(err)
  }
}

async function getEmployee(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const { id } = req.params

    // Employees can only view their own profile management roles can view anyone's.
    if (!MANAGEMENT_ROLES.includes(role) && userId !== id) {
      return res.status(403).json({ error: "You can only view your own profile" })
    }

    const employee = await prisma.user.findFirst({
      where: { id, organizationId },
      include: {
        department: true,
        manager: true,
        assignedAssets: true,
        tickets: { orderBy: { createdAt: "desc" } },
        lifecycleEvents: { orderBy: { occurredAt: "desc" }, take: 20, include: { asset: true } },
      },
    })

    if (!employee) return res.status(404).json({ error: "Employee not found" })

    // Sensitive personal fields (CNIC/DOB/address/bank details) are only
    // meaningful to the employee themselves or someone in a management
    // role. CNIC and the bank account number are stored encrypted at rest
    // and only decrypted right here, for an authorized viewer.
    const isSelfOrManagement = MANAGEMENT_ROLES.includes(role) || userId === id
    const { password, cnic, dob, address, bankAccountNumber, ...rest } = employee
    const safe = isSelfOrManagement
      ? { ...rest, cnic: decryptField(cnic), dob, address, bankAccountNumber: decryptField(bankAccountNumber) }
      : rest

    res.json(safe)
  } catch (err) {
    next(err)
  }
}

// Fields a management user may change on ANYONE (including their own
// record — "admin can edit any data, including their own").
const MANAGEMENT_EDITABLE_FIELDS = [
  "name",
  "email",
  "phone",
  "departmentId",
  "managerId",
  "status",
  "photoUrl",
  "cnic",
  "dob",
  "address",
  "skill",
  "seniorityLevel",
  "baseSalary",
  "bankName",
  "bankAccountNumber",
  "designation",
  "joiningDate",
  "workLocationType",
]

// Org policy: no salary below this. "further on" from here is just
// whatever management sets per employee/level — this is the floor, not a
// fixed scale.
const MIN_BASE_SALARY = 25000

// Fields a non-management user may change on THEMSELVES ONLY.
const SELF_EDITABLE_FIELDS = ["phone", "email"]

async function updateEmployee(req, res, next) {
  try {
    const { organizationId, userId, role: requesterRole } = req.user
    const { id } = req.params
    const isManagementRequester = MANAGEMENT_ROLES.includes(requesterRole)
    const isSelf = userId === id

    const existing = await prisma.user.findFirst({ where: { id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Employee not found" })

    const allowedFields = isManagementRequester
      ? MANAGEMENT_EDITABLE_FIELDS
      : isSelf
      ? SELF_EDITABLE_FIELDS
      : []

    if (allowedFields.length === 0) {
      return res.status(403).json({ error: "You can only edit your own profile" })
    }

    const data = {}
    for (const field of allowedFields) {
      if (req.body[field] === undefined) continue
      if (field === "dob") data.dob = req.body.dob ? new Date(req.body.dob) : null
      else if (field === "joiningDate") data.joiningDate = req.body.joiningDate ? new Date(req.body.joiningDate) : null
      else if (field === "workLocationType") {
        if (!["OFFICE", "FIELD"].includes(req.body.workLocationType)) {
          return res.status(400).json({ error: "workLocationType must be OFFICE or FIELD" })
        }
        data.workLocationType = req.body.workLocationType
      }
      else if (field === "cnic") data.cnic = encryptField(req.body.cnic)
      else if (field === "bankAccountNumber") data.bankAccountNumber = encryptField(req.body.bankAccountNumber)
      // Enum/foreign-key fields don't accept "" as a value — an empty
      // string from a "None" dropdown selection has to become null.
      else if (["seniorityLevel", "departmentId", "managerId"].includes(field)) {
        data[field] = req.body[field] || null
      } else if (field === "baseSalary") {
        const n = req.body.baseSalary === "" || req.body.baseSalary === null ? null : Number(req.body.baseSalary)
        if (n !== null && (Number.isNaN(n) || n < MIN_BASE_SALARY)) {
          return res.status(400).json({ error: `baseSalary must be at least PKR ${MIN_BASE_SALARY.toLocaleString()}` })
        }
        data.baseSalary = n
      } else data[field] = req.body[field]
    }

    if (data.email !== undefined) {
      const emailTaken = await prisma.user.findFirst({
        where: { email: data.email, organizationId, NOT: { id } },
      })
      if (emailTaken) return res.status(409).json({ error: "That email is already in use" })
    }

    // The Owner (ADMIN) or a CEO may change roles, and only to a known
    // role. This stops an HR/Sales Head account from promoting itself or
    // anyone else into a management role.
    if (req.body.role !== undefined) {
      if (!["ADMIN", "CEO"].includes(requesterRole)) {
        return res.status(403).json({ error: "Only the organization owner or a CEO can change roles" })
      }
      if (!ASSIGNABLE_ROLES.includes(req.body.role)) {
        return res.status(400).json({ error: `role must be one of: ${ASSIGNABLE_ROLES.join(", ")}` })
      }
      // The CEO is the org's top authority (payroll approval/payout, the
      // disbursement account) — capped at 2 so that authority stays
      // concentrated, per org policy.
      if (req.body.role === "CEO" && existing.role !== "CEO") {
        const ceoCount = await prisma.user.count({ where: { organization: { companyId }, role: "CEO" } })
        if (ceoCount >= MAX_CEO_COUNT) {
          return res.status(400).json({ error: `An organization can have at most ${MAX_CEO_COUNT} CEOs` })
        }
      }
      data.role = req.body.role
    }

    const updated = await prisma.user.update({ where: { id }, data })

    if (data.role && data.role !== existing.role) {
      logAudit({
        organizationId,
        actorId: userId,
        action: "employee.role_changed",
        targetType: "User",
        targetId: id,
        note: `${existing.role} -> ${data.role}`,
      })
    }

    res.json(stripSensitive(updated, isManagementRequester || isSelf))
  } catch (err) {
    next(err)
  }
}

// Only the organization owner (ADMIN) can remove an employee outright —
// management roles (CEO/Sales Head/HR) can view and edit, not delete.
async function deleteEmployee(req, res, next) {
  try {
    const { organizationId, userId, role: requesterRole } = req.user
    const { id } = req.params

    if (id === userId) {
      return res.status(400).json({ error: "You can't remove your own account" })
    }

    const existing = await prisma.user.findFirst({ where: { id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Employee not found" })

    // CEO accounts are protected from ADMIN/other management roles. Only a
    // CEO may remove another CEO. A CEO is also allowed to remove any other
    // account in the organization, including the original ADMIN owner.
    if (existing.role === "CEO" && requesterRole !== "CEO") {
      return res.status(403).json({ error: "Only a CEO can remove a CEO account" })
    }

    if (requesterRole !== "ADMIN" && requesterRole !== "CEO") {
      return res.status(403).json({ error: "Only an ADMIN or CEO can remove employees" })
    }

    const assignedAssets = await prisma.asset.findMany({ where: { assignedToId: id } })

    await prisma.$transaction([
      ...assignedAssets.map((asset) =>
        prisma.lifecycleEvent.create({
          data: {
            assetId: asset.id,
            type: "UNASSIGNED",
            actorId: userId,
            note: `Unassigned — ${existing.name} <${existing.email}> was removed from the organization`,
          },
        })
      ),
      ...assignedAssets.map((asset) =>
        prisma.asset.update({
          where: { id: asset.id },
          data: { status: "AVAILABLE", assignedToId: null },
        })
      ),
      prisma.user.delete({ where: { id } }),
    ])

    logAudit({ organizationId, actorId: userId, action: "employee.deleted", targetType: "User", targetId: id, note: `${existing.name} <${existing.email}> removed by ${requesterRole}` })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

const IMPORT_COLUMNS = ["name", "email", "phone", "department", "cnic", "dob", "address", "skill", "seniorityLevel", "role"]
const VALID_LEVELS = ["INTERN", "JUNIOR", "SENIOR", "LEAD"]

// Bulk-create employees from a CSV file. Expected header row (any order,
// case-insensitive): name, email, phone, department, cnic, dob, address,
// skill, seniorityLevel, role. Every created account gets a random temp
// password, same as single-add.
async function importEmployees(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload a .csv file under the 'file' field" })

    const { organizationId, companyId, role: requesterRole } = req.user
    const text = req.file.buffer.toString("utf8").replace(/^\uFEFF/, "")
    const rows = parseCsv(text)
    if (!rows.length) return res.status(400).json({ error: "The uploaded CSV is empty" })

    const headers = rows[0].map((value) => String(value || "").trim().toLowerCase().replace(/\s+/g, ""))
    const headerMap = {}
    headers.forEach((header, index) => {
      const match = IMPORT_COLUMNS.find((column) => column.toLowerCase() === header)
      if (match) headerMap[match] = index
    })

    if (headerMap.name === undefined || headerMap.email === undefined) {
      return res.status(400).json({ error: "The CSV must have at least 'name' and 'email' columns" })
    }

    const departments = await prisma.department.findMany({ where: { organizationId } })
    const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]))
    const created = []
    const skipped = []

    const valueAt = (row, key) => headerMap[key] === undefined ? "" : String(row[headerMap[key]] || "").trim()

    for (let index = 1; index < rows.length; index++) {
      const rowNumber = index + 1
      const row = rows[index]
      const name = valueAt(row, "name")
      const email = valueAt(row, "email")
      if (!name && !email) continue

      if (!name || !email) {
        skipped.push({ row: rowNumber, reason: "Missing name or email" })
        continue
      }

      const existing = await prisma.user.findFirst({ where: { organizationId, email } })
      if (existing) {
        skipped.push({ row: rowNumber, reason: `Email already exists (${email})` })
        continue
      }

      let assignedRole = "EMPLOYEE"
      if (headerMap.role !== undefined) {
        const raw = valueAt(row, "role").toUpperCase().replace(/\s+/g, "_")
        if (raw && ASSIGNABLE_ROLES.includes(raw)) {
          if (raw !== "EMPLOYEE" && !["ADMIN", "CEO"].includes(requesterRole)) {
            skipped.push({ row: rowNumber, reason: "Only the owner or a CEO can import management roles — imported as EMPLOYEE" })
          } else if (raw === "CEO") {
            const ceoCount = await prisma.user.count({ where: { organizationId, role: "CEO" } })
            if (ceoCount >= MAX_CEO_COUNT) {
              skipped.push({ row: rowNumber, reason: `The organization already has ${MAX_CEO_COUNT} CEOs` })
              continue
            }
            assignedRole = raw
          } else {
            assignedRole = raw
          }
        }
      }

      const departmentName = valueAt(row, "department")
      const seniorityLevel = valueAt(row, "seniorityLevel").toUpperCase()
      const dobRaw = valueAt(row, "dob")
      const dob = dobRaw ? new Date(dobRaw) : null
      if (dobRaw && (!dob || Number.isNaN(dob.getTime()))) {
        skipped.push({ row: rowNumber, reason: "Invalid date of birth" })
        continue
      }

      const tempPassword = Math.random().toString(36).slice(2, 10)
      const hashed = await bcrypt.hash(tempPassword, 10)

      try {
        const user = await prisma.user.create({
          data: {
            organizationId,
            name,
            email,
            password: hashed,
            role: assignedRole,
            phone: valueAt(row, "phone") || null,
            cnic: encryptField(valueAt(row, "cnic") || null),
            dob: dobRaw ? dob : null,
            address: valueAt(row, "address") || null,
            skill: valueAt(row, "skill") || null,
            seniorityLevel: VALID_LEVELS.includes(seniorityLevel) ? seniorityLevel : null,
            departmentId: deptByName.get(departmentName.toLowerCase()) || null,
          },
        })
        created.push({ row: rowNumber, name: user.name, email: user.email, tempPassword })
      } catch (err) {
        skipped.push({ row: rowNumber, reason: "Could not create row (check for duplicate/invalid data)" })
      }
    }

    res.json({ createdCount: created.length, skippedCount: skipped.length, created, skipped })
  } catch (err) {
    next(err)
  }
}

// A blank starter CSV with the columns importEmployees understands.
async function importTemplate(req, res, next) {
  try {
    const header = IMPORT_COLUMNS.join(",")
    const example = [
      "Jane Doe",
      "jane@example.com",
      "0300-1234567",
      "Engineering",
      "35202-1234567-1",
      "1995-01-20",
      "Lahore, Punjab",
      "Frontend Development",
      "JUNIOR",
      "EMPLOYEE",
    ].map((value) => {
      const text = String(value)
      return /[,\"\n]/.test(text) ? `"${text.replace(/\"/g, '""')}"` : text
    }).join(",")

    res.setHeader("Content-Type", "text/csv; charset=utf-8")
    res.setHeader("Content-Disposition", "attachment; filename=employee-import-template.csv")
    res.send(`${header}\n${example}\n`)
  } catch (err) {
    next(err)
  }
}

module.exports = {
  listEmployees,
  getEmployee,
  updateEmployee,
  deleteEmployee,
  importEmployees,
  importTemplate,
}
