const express = require("express")
const { listTickets, createTicket, updateTicketStatus, deleteTicket } = require("../controllers/ticket.controller")
const { requireAuth, requireModule } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.get("/", listTickets)
router.post("/", createTicket)
// Same fix as asset-requests: IT_MANAGER owns Support/Tickets but was never
// in the old requireManagement bucket, so it couldn't act on the tickets
// its own nav linked to.
router.patch("/:id/status", requireModule("tickets"), updateTicketStatus)
router.delete("/:id", requireModule("tickets"), deleteTicket)

module.exports = router
