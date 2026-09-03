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
const { requireAuth, requireManagement, requireInventoryAccess } = require("../middleware/auth.middleware");

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

router.get("/import/template", requireInventoryAccess, importAssetsTemplate);
router.post("/import", requireInventoryAccess, upload.single("file"), importAssets);

router.get("/categories", listCategories);
router.get("/", listAssets);
router.get("/:id", getAsset);
router.post("/", requireInventoryAccess, createAsset);
router.post("/:id/assign", requireInventoryAccess, assignAsset);
router.post("/:id/unassign", requireInventoryAccess, unassignAsset);
router.post("/:id/status", requireInventoryAccess, changeAssetStatus);
router.post("/:id/lifecycle", requireInventoryAccess, addLifecycleNote);
router.delete("/categories/:name", requireInventoryAccess, deleteCategory);
router.delete("/:id", requireInventoryAccess, deleteAsset);

module.exports = router;
