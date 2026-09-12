import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";
import { completeAMCSchema } from "./amc.validation.js";
import {
  generateAMC,
  getMyAMC,
  getAMCById,
  startAMC,
  saveChecklist,
  completeAMC,
  getAllAMC,
  getAMCDashboard,
  getEmployeeAMCSummary,
  downloadAMCReport,
  downloadAMCPhotoZip,
  downloadBulkAMCZip,
} from "./amc.controller.js";

const router = Router();

// Admin only
router.post(
  "/generate",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  generateAMC,
);
router.get(
  "/employee-summary",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getEmployeeAMCSummary,
);

// Admin + Supervisor
router.get(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "supervisor"),
  getAllAMC,
);
router.get(
  "/dashboard",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "supervisor"),
  getAMCDashboard,
);

router.get("/my-amc", verifyAccessToken, authorizeRoles("employee"), getMyAMC);

router.get(
  "/bulk-download",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  downloadBulkAMCZip,
);

// Shared (role enforcement in controller)
router.get(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "supervisor", "employee", "customer"),
  getAMCById,
);

// Employee only
router.put(
  "/:id/start",
  verifyAccessToken,
  authorizeRoles("employee"),
  startAMC,
);
router.put(
  "/:id/save-checklist",
  verifyAccessToken,
  authorizeRoles("employee"),
  saveChecklist,
);
router.put(
  "/:id/complete",
  verifyAccessToken,
  authorizeRoles("employee"),
  validateRequest(completeAMCSchema),
  completeAMC,
);

router.get(
  "/:id/report",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "supervisor", "employee", "customer"),
  downloadAMCReport,
);

router.get(
  "/:id/download-photos",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  downloadAMCPhotoZip,
);

export default router;
