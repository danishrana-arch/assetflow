const express = require("express")
const { listHolidays, createHoliday, deleteHoliday } = require("../controllers/holiday.controller")
const { requireAuth, requireManagement } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.get("/", listHolidays)
router.post("/", requireManagement, createHoliday)
router.delete("/:id", requireManagement, deleteHoliday)

module.exports = router
