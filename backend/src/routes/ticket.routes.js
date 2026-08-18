const express = require("express")
const { listTickets, createTicket, updateTicketStatus, deleteTicket } = require("../controllers/ticket.controller")
const { requireAuth, requireManagement } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.get("/", listTickets)
router.post("/", createTicket)
router.patch("/:id/status", requireManagement, updateTicketStatus)
router.delete("/:id", requireManagement, deleteTicket)

module.exports = router
