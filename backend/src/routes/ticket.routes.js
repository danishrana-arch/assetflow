const express = require("express")
const { listTickets, createTicket, updateTicketStatus, deleteTicket } = require("../controllers/ticket.controller")
const { requireAuth, requireManagement, requireInventoryAccess } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.get("/", listTickets)
router.post("/", createTicket)
router.patch("/:id/status", requireInventoryAccess, updateTicketStatus)
router.delete("/:id", requireInventoryAccess, deleteTicket)

module.exports = router
