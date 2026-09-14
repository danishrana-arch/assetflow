const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES } = require("../utils/roles")

function text(value) {
  return String(value || "").trim()
}

function limitRows(rows, max = 8) {
  return rows.slice(0, max)
}

async function globalSearch(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const q = text(req.query.q)

    if (q.length < 2) {
      return res.json({ query: q, results: [], total: 0 })
    }

    const contains = { contains: q, mode: "insensitive" }
    const isManagement = MANAGEMENT_ROLES.includes(role) || role === "MANAGER"
    const isIT = role === "IT_MANAGER"

    const [
      employees,
      assets,
      projects,
      tickets,
      announcements,
    ] = await Promise.all([
      prisma.user.findMany({
        where: {
          organizationId,
          status: { not: "LEFT_COMPANY" },
          AND: [
            ...(isManagement || isIT
              ? []
              : [{ id: userId }]),
            {
              OR: [
                { name: contains },
                { email: contains },
                { designation: contains },
                { skill: contains },
              ],
            },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          designation: true,
          department: { select: { name: true } },
        },
        orderBy: { name: "asc" },
        take: 8,
      }),
      prisma.asset.findMany({
        where: {
          organizationId,
          OR: [
            { name: contains },
            { category: contains },
            { serialNumber: contains },
            { cpu: contains },
            { ram: contains },
            { storage: contains },
          ],
          ...(isManagement || isIT
            ? {}
            : { assignedToId: userId }),
        },
        select: {
          id: true,
          name: true,
          category: true,
          serialNumber: true,
          status: true,
          assignedTo: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
      prisma.project.findMany({
        where: {
          organizationId,
          OR: [
            { name: contains },
            { description: contains },
            { clientName: contains },
          ],
          ...(isManagement || isIT
            ? {}
            : { members: { some: { employeeId: userId } } }),
        },
        select: {
          id: true,
          name: true,
          status: true,
          deadline: true,
          clientName: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
      prisma.ticket.findMany({
        where: {
          organizationId,
          OR: [
            { subject: contains },
            { description: contains },
            { category: contains },
          ],
          ...(isManagement || isIT
            ? {}
            : { raisedById: userId }),
        },
        select: {
          id: true,
          subject: true,
          status: true,
          priority: true,
          category: true,
          createdAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
      prisma.announcement.findMany({
        where: {
          organizationId,
          OR: [
            { title: contains },
            { body: contains },
          ],
        },
        select: {
          id: true,
          title: true,
          publishedAt: true,
        },
        orderBy: { publishedAt: "desc" },
        take: 8,
      }),
    ])

    const results = [
      ...limitRows(employees).map((item) => ({
        type: "employee",
        id: item.id,
        title: item.name,
        subtitle: [item.designation, item.department?.name, item.email].filter(Boolean).join(" · "),
        link: `/employees/${item.id}`,
      })),
      ...limitRows(assets).map((item) => ({
        type: "asset",
        id: item.id,
        title: item.name,
        subtitle: [item.category, item.serialNumber, item.assignedTo?.name ? `Assigned to ${item.assignedTo.name}` : "Available"].filter(Boolean).join(" · "),
        link: `/inventory/${item.id}`,
      })),
      ...limitRows(projects).map((item) => ({
        type: "project",
        id: item.id,
        title: item.name,
        subtitle: [item.status.replaceAll("_", " "), item.clientName, item.deadline ? `Due ${new Date(item.deadline).toLocaleDateString()}` : null].filter(Boolean).join(" · "),
        link: "/projects",
      })),
      ...limitRows(tickets).map((item) => ({
        type: "ticket",
        id: item.id,
        title: item.subject,
        subtitle: [item.priority, item.status.replaceAll("_", " "), item.category].filter(Boolean).join(" · "),
        link: "/tickets",
      })),
      ...limitRows(announcements).map((item) => ({
        type: "announcement",
        id: item.id,
        title: item.title,
        subtitle: "Announcement",
        link: "/announcements",
      })),
    ]

    res.json({
      query: q,
      results: results.slice(0, 30),
      total: results.length,
    })
  } catch (err) {
    next(err)
  }
}

module.exports = { globalSearch }
