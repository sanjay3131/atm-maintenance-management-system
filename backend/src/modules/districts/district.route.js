import express from "express";
import {
  createDistrict,
  deleteDistrict,
  getAllDistricts,
  getDistrictById,
  updateDistrict,
} from "./district.controller.js";
import {
  createDistrictSchema,
  updateDistrictSchema,
  validateRequest,
} from "./district.validation.js";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";

const router = express.Router();

router.post(
  "/",
  validateRequest(createDistrictSchema),
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  createDistrict,
);

router.get(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getAllDistricts,
);

router.get(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getDistrictById,
);

router.patch(
  "/:id",
  validateRequest(updateDistrictSchema),
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  updateDistrict,
);

router.delete(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  deleteDistrict,
);

export default router;
