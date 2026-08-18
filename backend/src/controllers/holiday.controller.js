const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")
const { toDateOnly } = require("../utils/date")

// Any authenticated user can view the holiday list (needed on the leave
// calendar and leave form). Only management can add/remove one.
async function listHolidays(req, res, next) {
  try {
    const { organizationId } = req.user
    const { year } = req.query

    const where = { organizationId }
    if (year) {
      const y = parseInt(year, 10)
      where.date = { gte: new Date(Date.UTC(y, 0, 1)), lte: new Date(Date.UTC(y, 11, 31, 23, 59, 59)) }
    }

    const holidays = await prisma.holiday.findMany({ where, orderBy: { date: "asc" } })
    res.json(holidays)
  } catch (err) {
    next(err)
  }
}

async function createHoliday(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { date, name } = req.body
    if (!date || !name || !name.trim()) {
      return res.status(400).json({ error: "date and name are required" })
    }

    const holiday = await prisma.holiday.create({
      data: { organizationId, date: toDateOnly(date), name: name.trim() },
    })
    logAudit({ organizationId, actorId: userId, action: "holiday.created", targetType: "Holiday", targetId: holiday.id, note: name })
    res.status(201).json(holiday)
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "A holiday already exists on that date" })
    next(err)
  }
}

async function deleteHoliday(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { id } = req.params

    const holiday = await prisma.holiday.findFirst({ where: { id, organizationId } })
    if (!holiday) return res.status(404).json({ error: "Holiday not found" })

    await prisma.holiday.delete({ where: { id } })
    logAudit({ organizationId, actorId: userId, action: "holiday.deleted", targetType: "Holiday", targetId: id, note: holiday.name })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

module.exports = { listHolidays, createHoliday, deleteHoliday }
