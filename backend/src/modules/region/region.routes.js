import express from "express";
import {
  createRegion,
  deactivateRegion,
  getAllRegions,
  getAllRegionsByDistrict,
  getRegionById,
  getRegionSummaries,
  getRegionsByBank,
  getRegionsByDistrict,
  updateRegion,
} from "./region.controller.js";
import {
  createRegionSchema,
  regionBankParamsSchema,
  regionDistrictParamsSchema,
  regionIdParamsSchema,
  regionListQuerySchema,
  regionSummaryQuerySchema,
  updateRegionSchema,
} from "./region.validate.js";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";

const router = express.Router();
router.use(verifyAccessToken, authorizeRoles("admin", "superAdmin"));

router.post("/", validateRequest(createRegionSchema), createRegion);
router.get("/", validateRequest(regionListQuerySchema, "query"), getAllRegions);
router.get(
  "/summary",
  validateRequest(regionSummaryQuerySchema, "query"),
  getRegionSummaries,
);
router.get("/:id", validateRequest(regionIdParamsSchema, "params"), getRegionById);
router.get(
  "/bank/:bankId",
  validateRequest(regionBankParamsSchema, "params"),
  validateRequest(regionListQuerySchema, "query"),
  getRegionsByBank,
);
router.get(
  "/district/:districtId",
  validateRequest(regionDistrictParamsSchema, "params"),
  getRegionsByDistrict,
);
router.get(
  "/district/:districtId/all",
  validateRequest(regionDistrictParamsSchema, "params"),
  getAllRegionsByDistrict,
);
router.patch(
  "/:id",
  validateRequest(regionIdParamsSchema, "params"),
  validateRequest(updateRegionSchema),
  updateRegion,
);
router.delete("/:id", validateRequest(regionIdParamsSchema, "params"), deactivateRegion);

export default router;
