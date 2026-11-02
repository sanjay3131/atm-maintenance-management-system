import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";
import {
  jobCostReportParamsSchema,
  refreshJobCostReportSchema,
  updateJobCostReportSchema,
} from "./jobCostReport.api.validation.js";
import {
  exportCostReport,
  initializeCostReport,
  patchCostReport,
  refreshCostReportMaterials,
  retrieveCostReport,
} from "./jobCostReport.controller.js";

const router = Router({ mergeParams: true });

router.use(verifyAccessToken);
router.use(authorizeRoles("admin", "superAdmin"));
router.use(validateRequest(jobCostReportParamsSchema, "params"));

router.post(
  "/materials/refresh",
  validateRequest(refreshJobCostReportSchema),
  refreshCostReportMaterials,
);
router.post("/", initializeCostReport);
router.get("/", retrieveCostReport);
router.get("/export.xlsx", exportCostReport);
router.patch(
  "/",
  validateRequest(updateJobCostReportSchema),
  patchCostReport,
);

export default router;
