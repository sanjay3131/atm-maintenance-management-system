import express from "express";
import {
  assignEmployeeToATM,
  createATM,
  deleteATM,
  getAllATMs,
  getATMById,
  updateATM,
  setATMLocation,
  getATMLocationStatus,
  setATMAMCResponsible,
  submitATMLocationRequest,
  listATMLocationRequests,
  getATMLocationRequest,
  approveATMLocationRequest,
  rejectATMLocationRequest,
  reopenATMLocationRequests,
  createATMLocationTasks,
  getATMLocationTasks,
  holdATMLocationTask,
  startATMLocationTask,
  resumeATMLocationTask,
  reassignATMLocationTask,
  reopenATMLocationTask,
  cancelATMLocationTask,
} from "./atm.controller.js";
import {
  createAtmSchema,
  updateAtmSchema,
  assignATMEmployeeSchema,
  setATMAMCResponsibleEmployeeSchema,
  submitATMLocationRequestSchema,
  atmLocationRequestParamsSchema,
  atmLocationRequestListQuerySchema,
  atmIdParamsSchema,
  rejectATMLocationRequestSchema,
  createATMLocationTasksSchema,
  listATMLocationTasksQuerySchema,
  locationTaskIdParamsSchema,
  reassignATMLocationTaskSchema,
  reopenATMLocationTaskSchema,
  cancelATMLocationTaskSchema,
  validateRequest,
} from "./atm.validation.js";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { validateRequest as validateRouteRequest } from "../../middlewares/validate.middleware.js";

const router = express.Router();

// create atm (admin / super-admin)
router.post(
  "/createATM",
  validateRequest(createAtmSchema),
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  createATM,
);

// view all atm (admin / super-admin)
router.get(
  "/getAllATMs",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getAllATMs,
);

// view single atm (admin / super-admin)
router.get(
  "/getATMById/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getATMById,
);
// update atm (admin / super-admin)
router.patch(
  "/updateATM/:id",
  verifyAccessToken,
  validateRequest(updateAtmSchema),
  authorizeRoles("admin", "superAdmin"),
  updateATM,
);
// delete atm (admin / super-admin)
router.delete(
  "/deleteATM/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  deleteATM,
);

// assign atm to employee

router.patch(
  "/assignEmployee/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(assignATMEmployeeSchema),
  assignEmployeeToATM,
);

router.patch(
  "/:id/amc-responsible",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(setATMAMCResponsibleEmployeeSchema),
  setATMAMCResponsible,
);

router.post(
  "/location-tasks/bulk",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(createATMLocationTasksSchema),
  createATMLocationTasks,
);

router.get(
  "/location-tasks",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "employee"),
  validateRouteRequest(listATMLocationTasksQuerySchema, "query"),
  getATMLocationTasks,
);

router.post(
  "/location-tasks/:taskId/start",
  verifyAccessToken,
  authorizeRoles("employee"),
  validateRouteRequest(locationTaskIdParamsSchema, "params"),
  startATMLocationTask,
);

router.post(
  "/location-tasks/:taskId/hold",
  verifyAccessToken,
  authorizeRoles("employee"),
  validateRouteRequest(locationTaskIdParamsSchema, "params"),
  holdATMLocationTask,
);

router.post(
  "/location-tasks/:taskId/resume",
  verifyAccessToken,
  authorizeRoles("employee"),
  validateRouteRequest(locationTaskIdParamsSchema, "params"),
  resumeATMLocationTask,
);

router.patch(
  "/location-tasks/:taskId/reassign",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRouteRequest(locationTaskIdParamsSchema, "params"),
  validateRequest(reassignATMLocationTaskSchema),
  reassignATMLocationTask,
);

router.post(
  "/location-tasks/:taskId/reopen",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRouteRequest(locationTaskIdParamsSchema, "params"),
  validateRequest(reopenATMLocationTaskSchema),
  reopenATMLocationTask,
);

router.post(
  "/location-tasks/:taskId/cancel",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRouteRequest(locationTaskIdParamsSchema, "params"),
  validateRequest(cancelATMLocationTaskSchema),
  cancelATMLocationTask,
);

router.post(
  "/location-requests",
  verifyAccessToken,
  authorizeRoles("employee", "admin", "superAdmin"),
  validateRequest(submitATMLocationRequestSchema),
  submitATMLocationRequest,
);

router.get(
  "/location-requests",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "employee"),
  validateRouteRequest(atmLocationRequestListQuerySchema, "query"),
  listATMLocationRequests,
);

router.get(
  "/location-requests/:requestId",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRouteRequest(atmLocationRequestParamsSchema, "params"),
  getATMLocationRequest,
);

router.post(
  "/:id/location-requests/reopen",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRouteRequest(atmIdParamsSchema, "params"),
  reopenATMLocationRequests,
);

router.post(
  "/location-requests/:requestId/approve",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRouteRequest(atmLocationRequestParamsSchema, "params"),
  approveATMLocationRequest,
);

router.post(
  "/location-requests/:requestId/reject",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRouteRequest(atmLocationRequestParamsSchema, "params"),
  validateRequest(rejectATMLocationRequestSchema),
  rejectATMLocationRequest,
);

// Employee sets ATM location
router.post(
  "/:id/set-location",
  verifyAccessToken,
  authorizeRoles("employee"),
  setATMLocation,
);

// Admin views location status
router.get(
  "/location-status",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getATMLocationStatus,
);
export default router;
