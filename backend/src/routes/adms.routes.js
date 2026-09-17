const express = require("express")
const c = require("../controllers/adms.controller")
const router = express.Router()

// ADMS devices POST plain text, not JSON — the app-wide express.json()
// middleware silently no-ops for non-JSON content types, so this captures
// the raw body specifically for these routes.
const textBody = express.text({ type: () => true, limit: "5mb" })

router.get("/cdata", c.cdataHandshake)
router.post("/cdata", textBody, c.cdataUpload)
router.get("/getrequest", c.getrequest)
router.post("/devicecmd", textBody, c.devicecmd)

module.exports = router
