const express = require("express")
const { listHolidays, createHoliday, deleteHoliday } = require("../controllers/holiday.controller")
const { requireAuth, requireModule } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.get("/", listHolidays)
router.post("/", requireModule("leave"), createHoliday)
router.delete("/:id", requireModule("leave"), deleteHoliday)

module.exports = router
