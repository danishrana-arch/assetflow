const express = require("express")
const { addCertification, updateCertification, deleteCertification } = require("../controllers/certification.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")

const router = express.Router()
router.use(requireAuth, requireRole("ADMIN", "CEO"))
router.post("/:id/certifications", addCertification)
router.patch("/:id/certifications/:certificationId", updateCertification)
router.delete("/:id/certifications/:certificationId", deleteCertification)

module.exports = router
