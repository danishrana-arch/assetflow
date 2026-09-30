const crypto = require("crypto")
const prisma = require("../lib/prisma")
const { collectCalendarEvents } = require("./dashboard.controller")

// Personal iCalendar (.ics) feed of the Company Calendar. Google Calendar
// and Outlook subscribe to a URL and re-fetch it on their own schedule, so
// the feed can't use the normal Bearer token. Instead the URL carries
// "<userId>.<HMAC(JWT_SECRET, userId:nonce)>", where the nonce is the random
// User.calendarFeedToken. Only the nonce is stored, so a user row that
// ends up in some API response can't be turned into a working feed URL.
// Resetting the link picks a new nonce, which cuts off old subscriptions.
// The feed shows exactly what the Company Calendar page shows that user
// (same leave-visibility rule).

const PAST_DAYS = 90
const FUTURE_DAYS = 365

function newNonce() {
  return crypto.randomBytes(24).toString("hex")
}

function sign(userId, nonce) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET).update(`calendar-feed:${userId}:${nonce}`).digest("hex")
}

function feedToken(userId, nonce) {
  return `${userId}.${sign(userId, nonce)}`
}

function apiBase(req) {
  const configured = String(process.env.API_PUBLIC_URL || "").trim().replace(/\/+$/, "")
  return configured || `${req.protocol}://${req.get("host")}/api`
}

function feedLinks(req, token) {
  const url = `${apiBase(req)}/calendar/feed/${token}.ics`
  const webcal = url.replace(/^https?:\/\//, "webcal://")
  const name = "AssetFlow Company Calendar"
  return {
    url,
    webcalUrl: webcal,
    googleUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    outlookUrl: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`,
    office365Url: `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`,
    isLocal: /\/\/(localhost|127\.|10\.|192\.168\.)/.test(url),
  }
}

async function getFeed(req, res, next) {
  try {
    const { userId } = req.user
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { calendarFeedToken: true } })
    let nonce = user?.calendarFeedToken
    if (!nonce) {
      nonce = newNonce()
      await prisma.user.update({ where: { id: userId }, data: { calendarFeedToken: nonce } })
    }
    res.json(feedLinks(req, feedToken(userId, nonce)))
  } catch (err) { next(err) }
}

async function resetFeed(req, res, next) {
  try {
    const nonce = newNonce()
    await prisma.user.update({ where: { id: req.user.userId }, data: { calendarFeedToken: nonce } })
    res.json(feedLinks(req, feedToken(req.user.userId, nonce)))
  } catch (err) { next(err) }
}

// RFC 5545 text escaping + 75-octet line folding.
function escapeText(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")
}

function fold(line) {
  const bytes = Buffer.from(line, "utf8")
  if (bytes.length <= 75) return line
  const parts = []
  let current = ""
  for (const ch of line) {
    if (Buffer.byteLength(current + ch, "utf8") > (parts.length ? 74 : 75)) {
      parts.push(current)
      current = ch
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts.join("\r\n ")
}

const CATEGORY = {
  BIRTHDAY: "Birthday",
  PROJECT_DEADLINE: "Project deadline",
  NATIONAL_HOLIDAY: "Holiday",
  EMPLOYEE_LEAVE: "Leave",
  ANNUAL_EVENT: "Company event",
}

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
}

function buildIcs({ events, calendarName, host }) {
  const now = stamp(new Date())
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AssetFlow//Company Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ]
  for (const e of events) {
    const day = e.date.replace(/-/g, "")
    const next = new Date(`${e.date}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(e.id)}@${host}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`,
      `SUMMARY:${escapeText(e.title)}`,
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      `CATEGORIES:${escapeText(CATEGORY[e.type] || e.type)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    )
  }
  lines.push("END:VCALENDAR")
  return lines.map(fold).join("\r\n") + "\r\n"
}

// Public (no auth header) - the token in the URL is the credential.
async function serveFeed(req, res, next) {
  try {
    const match = /^([A-Za-z0-9_-]{1,64})\.([a-f0-9]{64})$/.exec(String(req.params.token || ""))
    if (!match) return res.status(404).send("Not found")
    const [, userId, signature] = match
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true, organizationId: true, calendarFeedToken: true, organization: { select: { name: true } } },
    })
    const valid = user?.calendarFeedToken &&
      crypto.timingSafeEqual(Buffer.from(sign(user.id, user.calendarFeedToken), "hex"), Buffer.from(signature, "hex"))
    if (!valid || user.status === "LEFT_COMPANY") return res.status(404).send("Not found")

    const today = new Date()
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - PAST_DAYS))
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + FUTURE_DAYS))
    const events = await collectCalendarEvents({ organizationId: user.organizationId, userId: user.id, role: user.role, start, end })

    const body = buildIcs({
      events,
      calendarName: `${user.organization?.name || "AssetFlow"} Calendar`,
      host: req.get("host") || "assetflow",
    })
    res.set("Content-Type", "text/calendar; charset=utf-8")
    res.set("Content-Disposition", 'inline; filename="company-calendar.ics"')
    res.set("Cache-Control", "no-store")
    res.send(body)
  } catch (err) { next(err) }
}

module.exports = { getFeed, resetFeed, serveFeed }
