const express = require("express");
const multer = require("multer");
const {
  listAssets,
  listCategories,
  getAsset,
  createAsset,
  assignAsset,
  unassignAsset,
  changeAssetStatus,
  addLifecycleNote,
  importAssets,
  importAssetsTemplate,
  deleteAsset,
  deleteCategory,
} = require("../controllers/asset.controller");
const { requireAuth, requireManagement } = require("../middleware/auth.middleware");

const router = express.Router();

// Keep import files small and in memory only — never written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = /csv/.test(file.mimetype) || /\.csv$/i.test(file.originalname)
    cb(ok ? null : new Error("Only .csv files are supported"), ok)
  },
})

router.use(requireAuth);

router.get("/import/template", requireManagement, importAssetsTemplate);
router.post("/import", requireManagement, upload.single("file"), importAssets);

router.get("/categories", listCategories);
router.get("/", listAssets);
router.get("/:id", getAsset);
router.post("/", requireManagement, createAsset);
router.post("/:id/assign", requireManagement, assignAsset);
router.post("/:id/unassign", requireManagement, unassignAsset);
router.post("/:id/status", requireManagement, changeAssetStatus);
router.post("/:id/lifecycle", requireManagement, addLifecycleNote);
router.delete("/categories/:name", requireManagement, deleteCategory);
router.delete("/:id", requireManagement, deleteAsset);

module.exports = router;
