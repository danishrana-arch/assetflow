const express = require("express")
const { requireAuth } = require("../middleware/auth.middleware")
const { getEmployee360 } = require("../controllers/employee360.controller")
const router = express.Router()
router.use(requireAuth)
router.get("/:id", getEmployee360)
module.exports = router
