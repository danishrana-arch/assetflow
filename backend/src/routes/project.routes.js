const express = require("express")
const { requireAuth, requireModule } = require("../middleware/auth.middleware")
const { startProjectDeadlineNotificationJob } = require("../services/project-deadline-notification.service")
const { listProjects, getProject, createProject, updateProject, addProjectMembers, deleteProject, updateMemberHours } = require("../controllers/project.controller")
const { listWorkCategories, createWorkCategory, updateWorkCategory, deleteWorkCategory } = require("../controllers/work-category.controller")

const router = express.Router()
router.use(requireAuth)

startProjectDeadlineNotificationJob()

router.get("/work-categories", listWorkCategories)
router.post("/work-categories", requireModule("projects"), createWorkCategory)
router.patch("/work-categories/:id", requireModule("projects"), updateWorkCategory)
router.delete("/work-categories/:id", requireModule("projects"), deleteWorkCategory)
router.get("/", listProjects)
router.get("/:id", getProject)
router.post("/", requireModule("projects"), createProject)
router.patch("/:id", requireModule("projects"), updateProject)
router.delete("/:id", requireModule("projects"), deleteProject)
router.post("/:id/members", requireModule("projects"), addProjectMembers)
router.patch("/:id/members/:memberId", requireModule("projects"), updateMemberHours)

module.exports = router
