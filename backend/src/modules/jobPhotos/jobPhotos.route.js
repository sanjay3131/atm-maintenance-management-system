import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { upload } from "../../config/multer.js";
import {
  uploadPhotos,
  getJobPhotos,
  deletePhoto,
  getPhotoStats,
} from "./jobPhotos.controller.js";

const router = Router();

// Upload photos (max 3 per request)
router.post(
  "/upload/:jobId",
  verifyAccessToken,
  authorizeRoles("employee", "admin", "superAdmin"),
  upload.array("photos", 3),
  uploadPhotos,
);

// Get photos for a job
router.get(
  "/job/:jobId",
  verifyAccessToken,
  authorizeRoles("employee", "admin", "superAdmin", "customer"),
  getJobPhotos,
);

// Delete a photo
router.delete(
  "/:photoId",
  verifyAccessToken,
  authorizeRoles("employee", "admin", "superAdmin"),
  deletePhoto,
);

// Get photo stats (admin only)
router.get(
  "/stats",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getPhotoStats,
);

export default router;
