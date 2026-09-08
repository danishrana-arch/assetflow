const express = require("express")
const rateLimit = require("express-rate-limit")
const { getPublicEmployeeForm, submitPublicEmployeeForm } = require("../controllers/employee-form.controller")

const router = express.Router()
const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many form submissions. Please try again later." },
})
router.get("/:token", getPublicEmployeeForm)
router.post("/:token/submit", publicFormLimiter, submitPublicEmployeeForm)
module.exports = router
