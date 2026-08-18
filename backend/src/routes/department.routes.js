const express = require("express")
const { listDepartments, createDepartment, deleteDepartment } = require("../controllers/department.controller")
const { requireAuth, requireManagement } = require("../middleware/auth.middleware")

const router = express.Router()

router.use(requireAuth)

router.get("/", listDepartments)
router.post("/", requireManagement, createDepartment)
router.delete("/:id", requireManagement, deleteDepartment)

module.exports = router
