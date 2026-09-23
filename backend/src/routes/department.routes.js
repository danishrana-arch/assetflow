const express = require("express")
const { listDepartments, createDepartment, updateDepartment, deleteDepartment } = require("../controllers/department.controller")
const { requireAuth, requireRole } = require("../middleware/auth.middleware")
const router = express.Router()
router.use(requireAuth)
// Read is open to any authenticated user — listDepartments itself scopes a
// DEPARTMENT_HEAD down to just their own department, and other roles (e.g.
// picking a department on the Employees/Projects filters) need the list too.
router.get("/", listDepartments)
// Creating/renaming/reassigning departments is an org-structure change —
// ADMIN/CEO only, not even a DEPARTMENT_HEAD (who is scoped to their own
// department, not empowered to restructure it).
router.post("/", requireRole("ADMIN", "CEO"), createDepartment)
router.patch("/:id", requireRole("ADMIN", "CEO"), updateDepartment)
router.delete("/:id", requireRole("ADMIN", "CEO"), deleteDepartment)
module.exports = router
