const express = require("express")
const { listTimeEntries, createTimeEntry, deleteTimeEntry } = require("../controllers/timesheet.controller")
const { requireAuth } = require("../middleware/auth.middleware")
const router = express.Router(); router.use(requireAuth)
router.get("/", listTimeEntries); router.post("/", createTimeEntry); router.delete("/:id", deleteTimeEntry)
module.exports = router
