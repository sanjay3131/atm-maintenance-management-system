import express from "express";
import {
  createDistrict,
  deactivateDistrict,
  getAllDistricts,
  getDistrictById,
  getDistrictGeographicSummaries,
  getDistrictTransfers,
  transferDistrict,
  updateDistrict,
} from "./district.controller.js";
import {
  createDistrictSchema,
  districtIdParamsSchema,
  districtListQuerySchema,
  districtRegionParamsSchema,
  transferDistrictSchema,
  updateDistrictSchema,
} from "./district.validation.js";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";

const router = express.Router();

router.post(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(createDistrictSchema),
  createDistrict,
);

router.get(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(districtListQuerySchema, "query"),
  getAllDistricts,
);

router.get(
  "/geographic-summaries",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getDistrictGeographicSummaries,
);

router.get(
  "/region/:regionId",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(districtRegionParamsSchema, "params"),
  getAllDistricts,
);

router.get(
  "/:id/transfers",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(districtIdParamsSchema, "params"),
  getDistrictTransfers,
);

router.post(
  "/:id/transfer",
  verifyAccessToken,
  authorizeRoles("superAdmin"),
  validateRequest(districtIdParamsSchema, "params"),
  validateRequest(transferDistrictSchema),
  transferDistrict,
);

router.get(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(districtIdParamsSchema, "params"),
  getDistrictById,
);

router.patch(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(districtIdParamsSchema, "params"),
  validateRequest(updateDistrictSchema),
  updateDistrict,
);

router.delete(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(districtIdParamsSchema, "params"),
  deactivateDistrict,
);

export default router;
