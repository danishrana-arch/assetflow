const prisma = require("../lib/prisma")
const { toDateOnly } = require("../utils/date")

async function getStats(req, res, next) {
  try {
    const { organizationId } = req.user
    const in30Days = new Date()
    in30Days.setDate(in30Days.getDate() + 30)

    const [
      totalEmployees,
      totalAssets,
      assignedAssets,
      availableAssets,
      assetsUnderRepair,
      expiringWarranties,
      pendingRequests,
    ] = await Promise.all([
      prisma.user.count({ where: { organizationId, status: "ACTIVE" } }),
      prisma.asset.count({ where: { organizationId } }),
      prisma.asset.count({ where: { organizationId, status: "ASSIGNED" } }),
      prisma.asset.count({ where: { organizationId, status: "AVAILABLE" } }),
      prisma.asset.count({ where: { organizationId, status: "REPAIR" } }),
      prisma.asset.count({ where: { organizationId, warrantyEnd: { lte: in30Days, gte: new Date() } } }),
      prisma.ticket.count({ where: { organizationId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    ])

    res.json({
      totalEmployees,
      totalAssets,
      assignedAssets,
      availableAssets,
      assetsUnderRepair,
      expiringWarranties,
      pendingRequests,
    })
  } catch (err) {
    next(err)
  }
}

async function getRecentActivity(req, res, next) {
  try {
    const { organizationId } = req.user

    const events = await prisma.lifecycleEvent.findMany({
      where: { asset: { organizationId } },
      include: {
        asset: true,
        actor: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: 15,
    })

    res.json(events)
  } catch (err) {
    next(err)
  }
}

async function getLatestAssets(req, res, next) {
  try {
    const { organizationId } = req.user
    const assets = await prisma.asset.findMany({
      where: { organizationId },
      include: {
        assignedTo: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    })
    res.json(assets)
  } catch (err) {
    next(err)
  }
}

const MAX_RANGE_DAYS = 366

function parseRange(query) {
  const now = new Date()
  const todayUTC = toDateOnly(now)

  let end = query.end ? toDateOnly(query.end) : todayUTC
  let start = query.start ? toDateOnly(query.start) : new Date(todayUTC)
  if (!query.start) start.setUTCDate(start.getUTCDate() - 270) // ~9 months, matches old default

  // end is inclusive through the end of that calendar day.
  end = new Date(end)
  end.setUTCHours(23, 59, 59, 999)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: "start and end must be valid dates" }
  }
  if (end < start) {
    return { error: "end can't be before start" }
  }
  const spanDays = Math.round((end - start) / 86400000) + 1
  if (spanDays > MAX_RANGE_DAYS) {
    return { error: `Range can't exceed ${MAX_RANGE_DAYS} days` }
  }
  return { start, end, spanDays }
}

function bucketKey(date, granularity) {
  if (granularity === "day") return date.toISOString().slice(0, 10)
  if (granularity === "week") {
    const d = new Date(date)
    const day = d.getUTCDay()
    d.setUTCDate(d.getUTCDate() - day) // start of week (Sunday), UTC-safe
    return d.toISOString().slice(0, 10)
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}` // month
}

function bucketLabel(key, granularity) {
  const d = new Date(granularity === "month" ? `${key}-01T00:00:00.000Z` : `${key}T00:00:00.000Z`)
  const opts = { timeZone: "UTC" }
  if (granularity === "day") return d.toLocaleDateString(undefined, { ...opts, month: "short", day: "numeric" })
  if (granularity === "week") return `Wk of ${d.toLocaleDateString(undefined, { ...opts, month: "short", day: "numeric" })}`
  return d.toLocaleDateString(undefined, { ...opts, month: "short", year: "2-digit" })
}

// Real inventory activity for the dashboard bar chart, driven by actual
// lifecycle events instead of synthetic data. Admins/management pick any
// custom "from" / "to" date range; the bucket size (day/week/month) is
// chosen automatically based on how wide that range is so the chart stays
// readable.
async function getInventoryActivitySeries(req, res, next) {
  try {
    const { organizationId } = req.user
    const range = parseRange(req.query)
    if (range.error) return res.status(400).json({ error: range.error })
    const { start, end, spanDays } = range

    const granularity = spanDays <= 45 ? "day" : spanDays <= 180 ? "week" : "month"

    const events = await prisma.lifecycleEvent.findMany({
      where: {
        asset: { organizationId },
        occurredAt: { gte: start, lte: end },
      },
      select: { type: true, occurredAt: true },
    })

    const buckets = new Map()
    // Pre-seed buckets across the full range so empty periods still show.
    const cursor = new Date(start)
    while (cursor <= end) {
      const key = bucketKey(cursor, granularity)
      if (!buckets.has(key)) buckets.set(key, { assigned: 0, available: 0, repair: 0 })
      if (granularity === "day") cursor.setUTCDate(cursor.getUTCDate() + 1)
      else if (granularity === "week") cursor.setUTCDate(cursor.getUTCDate() + 7)
      else cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }

    for (const ev of events) {
      const key = bucketKey(ev.occurredAt, granularity)
      if (!buckets.has(key)) buckets.set(key, { assigned: 0, available: 0, repair: 0 })
      const bucket = buckets.get(key)
      if (ev.type === "ASSIGNED") bucket.assigned += 1
      else if (ev.type === "RETURNED" || ev.type === "UNASSIGNED") bucket.available += 1
      else if (ev.type === "REPAIR_STARTED") bucket.repair += 1
    }

    const series = Array.from(buckets.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, counts]) => ({ key, name: bucketLabel(key, granularity), ...counts }))

    res.json({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), granularity, series })
  } catch (err) {
    next(err)
  }
}

// Total repair spend broken down two ways: per asset (to flag which
// specific items are costing more to maintain than they're worth) and
// per category (to spot systemic problem categories). Only counts
// lifecycle events that actually recorded a cost.
async function getRepairSpend(req, res, next) {
  try {
    const { organizationId } = req.user

    const events = await prisma.lifecycleEvent.findMany({
      where: {
        cost: { not: null },
        type: { in: ["REPAIR_STARTED", "REPAIR_COMPLETED"] },
        asset: { organizationId },
      },
      select: { cost: true, asset: { select: { id: true, name: true, category: true, serialNumber: true } } },
    })

    const byAsset = new Map()
    const byCategory = new Map()
    let total = 0

    for (const ev of events) {
      const cost = Number(ev.cost)
      total += cost

      const assetKey = ev.asset.id
      const existingAsset = byAsset.get(assetKey) || { assetId: assetKey, name: ev.asset.name, serialNumber: ev.asset.serialNumber, total: 0, count: 0 }
      existingAsset.total += cost
      existingAsset.count += 1
      byAsset.set(assetKey, existingAsset)

      const categoryKey = ev.asset.category || "Uncategorized"
      const existingCategory = byCategory.get(categoryKey) || { category: categoryKey, total: 0, count: 0 }
      existingCategory.total += cost
      existingCategory.count += 1
      byCategory.set(categoryKey, existingCategory)
    }

    res.json({
      total,
      byAsset: Array.from(byAsset.values()).sort((a, b) => b.total - a.total).slice(0, 10),
      byCategory: Array.from(byCategory.values()).sort((a, b) => b.total - a.total),
    })
  } catch (err) {
    next(err)
  }
}

module.exports = { getStats, getRecentActivity, getLatestAssets, getInventoryActivitySeries, getRepairSpend }

async function getExecutiveOverview(req, res, next) {
  try {
    const { organizationId, companyId, role } = req.user
    const companyScope = ["ADMIN", "CEO"].includes(role) && String(req.query.scope || "").toLowerCase() === "company"
    const orgWhere = companyScope ? { companyId, archivedAt: null } : { id: organizationId, archivedAt: null }
    const organizations = await prisma.organization.findMany({
      where: orgWhere,
      select: { id: true, name: true, companyId: true, parentOrganizationId: true },
      orderBy: { name: "asc" },
    })
    const orgIds = organizations.map((o) => o.id)
    const today = toDateOnly(new Date())
    const tomorrow = new Date(today)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)

    const [employees, presentToday, lateToday, missingCheckout, projects, assets, groupedProjects] = await Promise.all([
      prisma.user.count({ where: { organizationId: { in: orgIds }, status: "ACTIVE" } }),
      prisma.attendanceRecord.count({ where: { organizationId: { in: orgIds }, date: { gte: today, lt: tomorrow }, status: { in: ["PRESENT", "LATE"] } } }),
      prisma.attendanceRecord.count({ where: { organizationId: { in: orgIds }, date: { gte: today, lt: tomorrow }, status: "LATE" } }),
      prisma.attendanceRecord.count({ where: { organizationId: { in: orgIds }, date: { gte: today, lt: tomorrow }, checkInAt: { not: null }, checkOutAt: null, status: { in: ["PRESENT", "LATE"] } } }),
      prisma.project.count({ where: { organizationId: { in: orgIds } } }),
      prisma.asset.count({ where: { organizationId: { in: orgIds } } }),
      prisma.project.groupBy({ by: ["status"], where: { organizationId: { in: orgIds } }, _count: { _all: true } }),
    ])

    const projectStatus = { NOT_STARTED: 0, IN_PROGRESS: 0, COMPLETED: 0 }
    groupedProjects.forEach((row) => { projectStatus[row.status] = row._count._all })

    res.json({
      scope: companyScope ? "company" : "organization",
      organizations,
      employees,
      presentToday,
      late: lateToday,
      missingCheckout,
      attendanceRate: employees ? Math.round((presentToday / employees) * 100) : 0,
      projects,
      assets,
      projectStatus,
    })
  } catch (err) { next(err) }
}

async function getAttendanceAnomalies(req, res, next) {
  try {
    const { organizationId, companyId, role } = req.user
    let organizationIds = [organizationId]
    if (["ADMIN", "CEO"].includes(role) && String(req.query.scope || "").toLowerCase() === "company") {
      organizationIds = (await prisma.organization.findMany({
        where: { companyId, archivedAt: null }, select: { id: true },
      })).map((o) => o.id)
    }
    const today = toDateOnly(new Date())
    const tomorrow = new Date(today)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const records = await prisma.attendanceRecord.findMany({
      where: { organizationId: { in: organizationIds }, date: { gte: today, lt: tomorrow } },
      include: { employee: { select: { id: true, name: true, email: true } } },
    })
    const anomalies = []
    for (const row of records) {
      if (row.autoFlagged || (row.distanceMeters != null && row.distanceMeters > 0)) {
        anomalies.push({
          type: "LOCATION", employee: row.employee,
          message: row.autoFlagged ? "Attendance was flagged for an office-location mismatch." : `Attendance was recorded ${row.distanceMeters}m from the configured office.`,
          distanceMeters: row.distanceMeters,
        })
      }
      if (row.checkInAt && !row.checkOutAt) anomalies.push({ type: "MISSING_CHECKOUT", employee: row.employee, message: "Employee has checked in but has not checked out." })
      if ((row.workingMinutes || 0) > 12 * 60) anomalies.push({ type: "LONG_DAY", employee: row.employee, message: `Working time is ${Math.round((row.workingMinutes / 60) * 10) / 10} hours.`, workingMinutes: row.workingMinutes })
    }
    res.json(anomalies.slice(0, 25))
  } catch (err) { next(err) }
}

async function listAnnouncements(req, res, next) {
  try {
    const { organizationId } = req.user
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { departmentId: true } })
    const rows = await prisma.announcement.findMany({
      where: {
        organizationId,
        OR: [
          { audienceType: "ALL" },
          ...(user?.departmentId ? [{ audienceType: "DEPARTMENT", audienceId: user.departmentId }] : []),
        ],
      },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { publishedAt: "desc" }, take: 100,
    })
    res.json(rows)
  } catch (err) { next(err) }
}

async function createAnnouncement(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { title, body, audienceType = "ALL", audienceId = null } = req.body
    if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: "title and body are required" })
    if (!["ALL", "DEPARTMENT"].includes(audienceType)) return res.status(400).json({ error: "Invalid audienceType" })
    if (audienceType === "DEPARTMENT") {
      if (!audienceId) return res.status(400).json({ error: "audienceId is required for department announcements" })
      const department = await prisma.department.findFirst({ where: { id: audienceId, organizationId } })
      if (!department) return res.status(400).json({ error: "Department not found in this organization" })
    }
    const row = await prisma.announcement.create({
      data: { organizationId, createdById: userId, title: title.trim(), body: body.trim(), audienceType, audienceId: audienceType === "DEPARTMENT" ? audienceId : null },
      include: { createdBy: { select: { id: true, name: true } } },
    })
    res.status(201).json(row)
  } catch (err) { next(err) }
}

async function deleteAnnouncement(req, res, next) {
  try {
    const { organizationId } = req.user
    const row = await prisma.announcement.findFirst({ where: { id: req.params.id, organizationId } })
    if (!row) return res.status(404).json({ error: "Announcement not found" })
    await prisma.announcement.delete({ where: { id: row.id } })
    res.status(204).send()
  } catch (err) { next(err) }
}

module.exports = {
  getStats, getRecentActivity, getLatestAssets, getInventoryActivitySeries, getRepairSpend,
  getExecutiveOverview, getAttendanceAnomalies, listAnnouncements, createAnnouncement, deleteAnnouncement,
}

function calendarDate(year, month, day) {
  return new Date(Date.UTC(year, month, day))
}

async function getCalendarEvents(req, res, next) {
  try {
    const { organizationId } = req.user
    const range = req.query.range === "month" ? "month" : "week"
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = now.getUTCMonth()
    const today = calendarDate(year, month, now.getUTCDate())
    let start = new Date(today)
    let end = new Date(today)

    if (range === "week") {
      const day = start.getUTCDay()
      start.setUTCDate(start.getUTCDate() - day)
      end = new Date(start)
      end.setUTCDate(end.getUTCDate() + 6)
    } else {
      start = calendarDate(year, month, 1)
      end = calendarDate(year, month + 1, 0)
    }

    const [employees, holidays, projects, leaves, companyEvents] = await Promise.all([
      prisma.user.findMany({
        where: { organizationId, status: { not: "LEFT_COMPANY" }, OR: [{ dob: { not: null } }, { joiningDate: { not: null } }] },
        select: { id: true, name: true, dob: true, joiningDate: true },
      }),
      prisma.holiday.findMany({
        where: { organizationId, date: { gte: start, lte: end } },
        orderBy: { date: "asc" },
      }),
      prisma.project.findMany({
        where: { organizationId, deadline: { gte: start, lte: end } },
        select: { id: true, name: true, deadline: true, status: true },
        orderBy: { deadline: "asc" },
      }),
      prisma.leaveApplication.findMany({
        where: { organizationId, status: "APPROVED", startDate: { lte: end }, endDate: { gte: start } },
        select: { id: true, employeeId: true, startDate: true, endDate: true, type: true, reason: true, employee: { select: { name: true } } },
        orderBy: { startDate: "asc" },
      }),
      prisma.companyEvent.findMany({
        where: { organizationId, date: { gte: calendarDate(year, 0, 1), lte: calendarDate(year, 11, 31) } },
        orderBy: { date: "asc" },
      }),
    ])

    const events = []
    const push = (event) => {
      const d = new Date(event.date)
      if (d < start || d > new Date(end.getTime() + 86400000 - 1)) return
      events.push({ ...event, date: d.toISOString().slice(0, 10) })
    }

    for (const e of employees) {
      if (e.dob) {
        const dob = new Date(e.dob)
        const birthday = calendarDate(year, dob.getUTCMonth(), dob.getUTCDate())
        if (birthday >= start && birthday <= end) {
          push({ id: `birthday-${e.id}-${year}`, type: "BIRTHDAY", title: `${e.name}'s birthday`, description: `Birthday of ${e.name}`, date: birthday, employeeId: e.id, employeeName: e.name })
        }
      }

      if (e.joiningDate) {
        const joinDate = new Date(e.joiningDate)
        const anniversary = calendarDate(year, joinDate.getUTCMonth(), joinDate.getUTCDate())
        const yearsWorked = year - joinDate.getUTCFullYear()
        if (yearsWorked >= 1 && anniversary >= start && anniversary <= end) {
          const anniversaryLabel = yearsWorked === 1 ? "1-year work anniversary" : `${yearsWorked}-year work anniversary`
          push({
            id: `anniversary-${e.id}-${year}`,
            type: "WORK_ANNIVERSARY",
            title: `${e.name}'s ${anniversaryLabel}`,
            description: yearsWorked === 1 ? `Completed 1 year with the company` : `Completed ${yearsWorked} years with the company`,
            date: anniversary,
            employeeId: e.id,
            employeeName: e.name,
          })
        }
      }
    }
    for (const h of holidays) push({ id: h.id, type: "NATIONAL_HOLIDAY", title: h.name, description: "National/company holiday", date: h.date })
    for (const p of projects) push({ id: `deadline-${p.id}`, type: "PROJECT_DEADLINE", title: `${p.name} deadline`, description: `Project deadline · ${p.status.replaceAll("_", " ")}`, date: p.deadline, projectId: p.id })
    for (const l of leaves) {
      const cursor = new Date(l.startDate)
      const last = new Date(l.endDate)
      while (cursor <= last) {
        const day = new Date(cursor)
        if (day >= start && day <= end) push({ id: `leave-${l.id}-${day.toISOString().slice(0, 10)}`, type: "EMPLOYEE_LEAVE", title: `${l.employee.name} is on leave`, description: `${l.type} leave${l.reason ? ` · ${l.reason}` : ""}`, date: day, employeeId: l.employeeId, employeeName: l.employee.name })
        cursor.setUTCDate(cursor.getUTCDate() + 1)
      }
    }
    for (const e of companyEvents) {
      let date = new Date(e.date)
      if (e.isAnnual) date = calendarDate(year, date.getUTCMonth(), date.getUTCDate())
      push({ id: e.id, type: e.type || "ANNUAL_EVENT", title: e.title, description: e.description, date, isAnnual: e.isAnnual })
    }

    events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
    const monthStart = calendarDate(year, month, 1)
    const monthEnd = calendarDate(year, month + 1, 0)
    const calendar = events.filter((e) => e.date >= monthStart.toISOString().slice(0, 10) && e.date <= monthEnd.toISOString().slice(0, 10))

    res.json({ range, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), events, calendar })
  } catch (err) {
    next(err)
  }
}

async function createCalendarEvent(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { title, date, description, isAnnual = true, type = "ANNUAL_EVENT" } = req.body
    if (!title?.trim() || !date) return res.status(400).json({ error: "title and date are required" })
    const parsed = new Date(date)
    if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: "date must be valid" })
    const event = await prisma.companyEvent.create({ data: { organizationId, createdById: userId, title: title.trim(), date: parsed, description: description?.trim() || null, type, isAnnual: Boolean(isAnnual) } })
    res.status(201).json(event)
  } catch (err) { next(err) }
}

module.exports.getCalendarEvents = getCalendarEvents
module.exports.createCalendarEvent = createCalendarEvent
