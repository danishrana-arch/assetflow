const express = require("express")
const { globalSearch } = require("../controllers/search.controller")
const { requireAuth } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)
router.get("/", globalSearch)

module.exports = router
