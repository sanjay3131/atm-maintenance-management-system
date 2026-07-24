import express from "express";
import {
  createRegion,
  deleteRegion,
  getAllRegions,
  getRegionById,
  getRegionsByDistrict,
  updateRegion,
} from "./region.controller.js";
import {
  createRegionSchema,
  updateRegionSchema,
  validateRequest,
} from "./region.validate.js";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";

const router = express.Router();

router.post(
  "/",
  validateRequest(createRegionSchema),
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  createRegion,
);

router.get(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getAllRegions,
);

router.get(
  "/district/:districtId",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getRegionsByDistrict,
);

router.get(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getRegionById,
);

router.patch(
  "/:id",
  validateRequest(updateRegionSchema),
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  updateRegion,
);

router.delete(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  deleteRegion,
);

export default router;
