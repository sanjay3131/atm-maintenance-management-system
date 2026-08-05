import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";

import {
  createJobSchema,
  assignJobSchema,
  completeJobSchema,
  reassignJobSchema,
  verifyJobSchema,
  approveJobSchema,
} from "./jobs.validation.js";
import {
  createJob,
  assignJob,
  acceptJob,
  startJob,
  completeJob,
  verifyJob,
  approveJob,
  closeJob,
  reassignJob,
  getAllJobs,
  getJobById,
  getMyJobs,
  getJobHistory,
  updateJob,
  deleteJob,
  holdJob,
} from "./jobs.controller.js";

const router = Router();

// Admin routes
router.post(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(createJobSchema),
  createJob,
);
router.get(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "employee", "customer"),
  getAllJobs,
);
router.put(
  "/:id/assign",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(assignJobSchema),
  assignJob,
);
router.put(
  "/:id/reassign",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(reassignJobSchema),
  reassignJob,
);
router.put(
  "/:id/verify",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(verifyJobSchema),
  verifyJob,
);
router.put(
  "/:id/approve",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(approveJobSchema),
  approveJob,
);
router.put(
  "/:id/close",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  closeJob,
);
router.put(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  updateJob,
);
router.delete(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  deleteJob,
);

// Employee routes
router.get(
  "/my-jobs",
  verifyAccessToken,
  authorizeRoles("employee"),
  getMyJobs,
);
router.put(
  "/:id/accept",
  verifyAccessToken,
  authorizeRoles("employee"),
  acceptJob,
);
router.put(
  "/:id/start",
  verifyAccessToken,
  authorizeRoles("employee"),
  startJob,
);
router.put(
  "/:id/complete",
  verifyAccessToken,
  authorizeRoles("employee"),
  validateRequest(completeJobSchema),
  completeJob,
);
router.put("/:id/hold", verifyAccessToken, authorizeRoles("employee"), holdJob);

// Shared routes
router.get(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "employee", "customer"),
  getJobById,
);
router.get(
  "/:id/history",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "employee", "customer"),
  getJobHistory,
);

export default router;
