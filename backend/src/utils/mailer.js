const nodemailer = require("nodemailer")

// Shared SMTP sender. Uses the same SMTP_* variables as the project-deadline
// reminder job. Returns false (instead of throwing) when SMTP isn't
// configured, so callers can degrade gracefully.
function getTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.SMTP_FROM) return null
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
}

function isEmailConfigured() {
  return Boolean(getTransporter())
}

async function sendEmail({ to, subject, text, html }) {
  const transporter = getTransporter()
  if (!transporter || !to) return false
  await transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, text, html })
  return true
}

// Base URL of the frontend, used to build links inside emails.
function appUrl() {
  const configured = process.env.APP_URL || String(process.env.CLIENT_ORIGIN || "").split(",")[0].trim()
  return (configured && configured !== "*" ? configured : "http://localhost:5173").replace(/\/+$/, "")
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
}

module.exports = { sendEmail, isEmailConfigured, appUrl, escapeHtml }
