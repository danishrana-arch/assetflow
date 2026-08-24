const nodemailer = require("nodemailer")
const prisma = require("../lib/prisma")

const REMINDER_DAYS = Math.max(1, Number(process.env.PROJECT_DEADLINE_REMINDER_DAYS || 3))
let running = false

function getTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.SMTP_FROM) return null
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(value))
}

function uniqueEmails(users) {
  return [...new Set(users.map(user => user?.email).filter(Boolean))]
}

async function sendProjectDeadlineEmail(project, recipients, type) {
  const transporter = getTransporter()
  if (!transporter || !recipients.length) return false

  const isOverdue = type === "overdue"
  const subject = isOverdue ? `Project deadline passed: ${project.name}` : `Project deadline is approaching: ${project.name}`
  const headline = isOverdue ? "Project deadline has passed" : "Project deadline is approaching"
  const message = isOverdue
    ? `The deadline for <strong>${project.name}</strong> passed on ${formatDate(project.deadline)}. Please review the project and either complete it or extend the deadline.`
    : `The deadline for <strong>${project.name}</strong> is ${formatDate(project.deadline)}. Please review the remaining work and make sure the project stays on schedule.`

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: recipients.join(","),
    subject,
    text: `${headline}. ${project.name} — deadline: ${formatDate(project.deadline)}.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#1f2937;line-height:1.6"><h2>${headline}</h2><p>${message}</p><p><strong>Client:</strong> ${project.clientName || "Internal project"}</p><p><strong>Deadline:</strong> ${formatDate(project.deadline)}</p><p><strong>Status:</strong> ${project.status.replaceAll("_", " ")}</p></div>`,
  })
  return true
}

async function processProjectDeadlineNotifications() {
  if (running) return
  running = true

  try {
    if (!getTransporter()) return

    const now = new Date()
    const reminderLimit = new Date(now.getTime() + REMINDER_DAYS * 24 * 60 * 60 * 1000)
    const projects = await prisma.project.findMany({
      where: {
        status: { not: "COMPLETED" },
        deadline: { not: null, lte: reminderLimit },
        OR: [
          { deadlineReminderSentAt: null },
          { deadlineOverdueNotifiedAt: null },
        ],
      },
      include: { members: { include: { employee: { select: { id: true, email: true } } } } },
    })

    for (const project of projects) {
      const deadlineEnd = new Date(project.deadline)
      deadlineEnd.setUTCHours(23, 59, 59, 999)
      const deadlineEndTime = deadlineEnd.getTime()
      const isOverdue = deadlineEndTime < now.getTime()
      const isNear = deadlineEndTime >= now.getTime() && deadlineEndTime <= reminderLimit.getTime()
      if (!isOverdue && !isNear) continue
      if (isOverdue && project.deadlineOverdueNotifiedAt) continue
      if (isNear && project.deadlineReminderSentAt) continue
      const admins = await prisma.user.findMany({
        where: { organizationId: project.organizationId, role: { in: ["ADMIN", "CEO"] } },
        select: { email: true },
      })
      const emails = uniqueEmails([...admins, ...project.members.map(member => member.employee)])
      if (!emails.length) continue

      try {
        const sent = await sendProjectDeadlineEmail(project, emails, isOverdue ? "overdue" : "reminder")
        if (!sent) continue
        await prisma.project.update({
          where: { id: project.id },
          data: isOverdue ? { deadlineOverdueNotifiedAt: new Date() } : { deadlineReminderSentAt: new Date() },
        })
      } catch (emailError) {
        console.error(`Project deadline email failed for ${project.id}:`, emailError.message)
      }
    }
  } catch (error) {
    console.error("Project deadline notification job failed:", error.message)
  } finally {
    running = false
  }
}

function startProjectDeadlineNotificationJob() {
  setTimeout(processProjectDeadlineNotifications, 10_000)
  setInterval(processProjectDeadlineNotifications, 60 * 60 * 1000)
}

module.exports = { startProjectDeadlineNotificationJob, processProjectDeadlineNotifications }
