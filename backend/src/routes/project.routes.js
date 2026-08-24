const express = require("express")
const { requireAuth, requireManagement } = require("../middleware/auth.middleware")
const { startProjectDeadlineNotificationJob } = require("../services/project-deadline-notification.service")
const { listProjects, getProject, createProject, updateProject, updateMemberHours } = require("../controllers/project.controller")

const router = express.Router()
router.use(requireAuth)

startProjectDeadlineNotificationJob()

router.get("/", listProjects)
router.get("/:id", getProject)
router.post("/", requireManagement, createProject)
router.patch("/:id", requireManagement, updateProject)
router.patch("/:id/members/:memberId", requireManagement, updateMemberHours)

module.exports = router
