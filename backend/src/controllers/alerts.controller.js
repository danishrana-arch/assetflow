const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES } = require("../utils/roles")
const { toDateOnly } = require("../utils/date")

function alert(type, severity, title, message, link) {
  return { type, severity, title, message, link }
}

async function getSmartAlerts(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const management = MANAGEMENT_ROLES.includes(role)
    const isIT = role === "IT_MANAGER"
    const today = toDateOnly(new Date())
    const tomorrow = new Date(today)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)

    const in7Days = new Date(today)
    in7Days.setUTCDate(in7Days.getUTCDate() + 7)
    const in30Days = new Date(today)
    in30Days.setUTCDate(in30Days.getUTCDate() + 30)

    const [
      pendingAssets,
      pendingLeaves,
      openTickets,
      warrantyAssets,
      overdueProjects,
      upcomingProjects,
      missingCheckout,
      expiringCertifications,
      myPendingAssets,
      myPendingLeaves,
      myTickets,
      myProjects,
      myCertifications,
    ] = await Promise.all([
      management
        ? prisma.assetRequest.count({ where: { organizationId, status: "PENDING" } })
        : 0,
      management
        ? prisma.leaveApplication.count({ where: { organizationId, status: "PENDING" } })
        : 0,
      (management || isIT)
        ? prisma.ticket.count({ where: { organizationId, status: { in: ["OPEN", "IN_PROGRESS"] } } })
        : 0,
      (management || isIT)
        ? prisma.asset.count({
            where: {
              organizationId,
              warrantyEnd: { gte: today, lte: in30Days },
            },
          })
        : 0,
      management
        ? prisma.project.count({
            where: {
              organizationId,
              deadline: { lt: today },
              status: { not: "COMPLETED" },
            },
          })
        : 0,
      management
        ? prisma.project.count({
            where: {
              organizationId,
              deadline: { gte: today, lte: in7Days },
              status: { not: "COMPLETED" },
            },
          })
        : 0,
      management
        ? prisma.attendanceRecord.count({
            where: {
              organizationId,
              date: { gte: today, lt: tomorrow },
              checkInAt: { not: null },
              checkOutAt: null,
            },
          })
        : 0,
      management
        ? prisma.certification.count({
            where: {
              employee: { organizationId },
              expiryDate: { gte: today, lte: in30Days },
            },
          })
        : 0,
      !management && !isIT
        ? prisma.assetRequest.count({ where: { organizationId, employeeId: userId, status: "PENDING" } })
        : 0,
      !management && !isIT
        ? prisma.leaveApplication.count({ where: { organizationId, employeeId: userId, status: "PENDING" } })
        : 0,
      !management && !isIT
        ? prisma.ticket.count({ where: { organizationId, raisedById: userId, status: { in: ["OPEN", "IN_PROGRESS"] } } })
        : 0,
      !management && !isIT
        ? prisma.project.count({
            where: {
              organizationId,
              status: { not: "COMPLETED" },
              deadline: { gte: today, lte: in7Days },
              members: { some: { employeeId: userId } },
            },
          })
        : 0,
      !management && !isIT
        ? prisma.certification.count({
            where: {
              employeeId: userId,
              expiryDate: { gte: today, lte: in30Days },
            },
          })
        : 0,
    ])

    const alerts = []

    if (management) {
      if (pendingAssets) alerts.push(alert("ASSET_REQUESTS", "warning", "Asset requests need review", `${pendingAssets} asset request${pendingAssets === 1 ? "" : "s"} are waiting for approval.`, "/asset-requests"))
      if (pendingLeaves) alerts.push(alert("LEAVE_REQUESTS", "warning", "Leave requests need review", `${pendingLeaves} leave request${pendingLeaves === 1 ? "" : "s"} are waiting for approval.`, "/leave-requests"))
      if (overdueProjects) alerts.push(alert("OVERDUE_PROJECTS", "critical", "Projects are overdue", `${overdueProjects} active project${overdueProjects === 1 ? "" : "s"} passed its deadline.`, "/projects"))
      if (upcomingProjects) alerts.push(alert("PROJECT_DEADLINES", "warning", "Project deadlines approaching", `${upcomingProjects} active project${upcomingProjects === 1 ? "" : "s"} is due within 7 days.`, "/projects"))
      if (missingCheckout) alerts.push(alert("MISSING_CHECKOUT", "warning", "Missing check-outs", `${missingCheckout} employee${missingCheckout === 1 ? "" : "s"} checked in without checking out.`, "/attendance"))
      if (expiringCertifications) alerts.push(alert("CERTIFICATIONS", "warning", "Certifications expiring", `${expiringCertifications} certification${expiringCertifications === 1 ? "" : "s"} expire within 30 days.`, "/employees"))
    }

    if (management || isIT) {
      if (warrantyAssets) alerts.push(alert("WARRANTY", "warning", "Warranty deadlines approaching", `${warrantyAssets} asset${warrantyAssets === 1 ? "" : "s"} have warranties ending within 30 days.`, "/inventory"))
      if (openTickets) alerts.push(alert("SUPPORT", "info", "Open support tickets", `${openTickets} support ticket${openTickets === 1 ? "" : "s"} are currently open or in progress.`, "/tickets"))
    }

    if (!management && !isIT) {
      if (myPendingAssets) alerts.push(alert("MY_ASSET_REQUEST", "warning", "Asset request pending", "Your asset request is waiting for management review.", "/asset-requests"))
      if (myPendingLeaves) alerts.push(alert("MY_LEAVE_REQUEST", "warning", "Leave request pending", "Your leave request is waiting for management review.", "/leave-requests"))
      if (myTickets) alerts.push(alert("MY_TICKETS", "info", "Support tickets in progress", `${myTickets} of your support ticket${myTickets === 1 ? "" : "s"} are open or in progress.`, "/tickets"))
      if (myProjects) alerts.push(alert("MY_PROJECTS", "warning", "Project deadline approaching", `${myProjects} assigned project${myProjects === 1 ? "" : "s"} are due within 7 days.`, "/projects"))
      if (myCertifications) alerts.push(alert("MY_CERTIFICATIONS", "warning", "Certification expiring", `${myCertifications} of your certification${myCertifications === 1 ? "" : "s"} expire within 30 days.`, `/employees/${userId}`))
    }

    const priority = { critical: 0, warning: 1, info: 2 }
    alerts.sort((a, b) => priority[a.severity] - priority[b.severity])

    res.json(alerts.slice(0, 8))
  } catch (err) {
    next(err)
  }
}

module.exports = { getSmartAlerts }
