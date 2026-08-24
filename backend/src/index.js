require("dotenv").config()
const express = require("express")
const cors = require("cors")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")

const authRoutes = require("./routes/auth.routes")
const employeeRoutes = require("./routes/employee.routes")
const assetRoutes = require("./routes/asset.routes")
const departmentRoutes = require("./routes/department.routes")
const ticketRoutes = require("./routes/ticket.routes")
const dashboardRoutes = require("./routes/dashboard.routes")
const exportRoutes = require("./routes/export.routes")
const organizationRoutes = require("./routes/organization.routes")
const attendanceRoutes = require("./routes/attendance.routes")
const biometricRoutes = require("./routes/biometric.routes")
const leaveRoutes = require("./routes/leave.routes")
const holidayRoutes = require("./routes/holiday.routes")
const auditRoutes = require("./routes/audit.routes")
const assetRequestRoutes = require("./routes/asset-request.routes")
const payrollRoutes = require("./routes/payroll.routes")
const projectRoutes = require("./routes/project.routes")
const { notFound, errorHandler } = require("./middleware/error.middleware")

if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET is not set. Refusing to start.")
  process.exit(1)
}
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
  console.error(
    "FATAL: ENCRYPTION_KEY is not set (must be a 64-char hex string). Refusing to start.\n" +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  )
  process.exit(1)
}

const app = express()

app.disable("x-powered-by")
app.set("trust proxy", 1)

app.use(helmet())
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "*" }))
app.use(express.json({ limit: "2mb" }))

app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
  })
)

app.get("/health", (req, res) => res.json({ status: "ok" }))

app.use("/api/auth", authRoutes)
app.use("/api/employees", employeeRoutes)
app.use("/api/assets", assetRoutes)
app.use("/api/departments", departmentRoutes)
app.use("/api/tickets", ticketRoutes)
app.use("/api/dashboard", dashboardRoutes)
app.use("/api/export", exportRoutes)
app.use("/api/organization", organizationRoutes)
app.use("/api/attendance", attendanceRoutes)
app.use("/api/biometric", biometricRoutes)
app.use("/api/leaves", leaveRoutes)
app.use("/api/holidays", holidayRoutes)
app.use("/api/audit-log", auditRoutes)
app.use("/api/asset-requests", assetRequestRoutes)
app.use("/api/payroll", payrollRoutes)
app.use("/api/projects", projectRoutes)

app.use(notFound)
app.use(errorHandler)

const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`AssetFlow API listening on port ${PORT}`)
})
