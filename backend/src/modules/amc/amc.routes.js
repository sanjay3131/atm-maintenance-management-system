import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
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

// Shared (role enforcement in controller)
router.get("/:id", verifyAccessToken, getAMCById);

// Employee only
router.get("/my-amc", verifyAccessToken, authorizeRoles("employee"), getMyAMC);
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
  completeAMC,
);

export default router;
