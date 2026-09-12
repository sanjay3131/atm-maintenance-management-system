import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { upload } from "../../config/multer.js";
import {
  uploadAMCPhotos,
  getAMCPhotos,
  deleteAMCPhoto,
} from "./amcPhoto.controller.js";

const router = Router();

router.post(
  "/upload/:amcId",
  verifyAccessToken,
  authorizeRoles("employee"),
  upload.array("photos", 6),
  uploadAMCPhotos,
);

router.get(
  "/:amcId",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "supervisor", "employee", "customer"),
  getAMCPhotos,
);

router.delete(
  "/:photoId",
  verifyAccessToken,
  authorizeRoles("employee", "admin", "superAdmin"),
  deleteAMCPhoto,
);

export default router;
