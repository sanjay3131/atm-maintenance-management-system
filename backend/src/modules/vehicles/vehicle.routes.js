import { Router } from "express";
import ApiError from "../../utils/ApiError.js";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";
import { requireVehicleIndexes } from "./vehicleIndexReadiness.js";
import { vehicleErrorMiddleware } from "./vehicle.errors.js";
import {
  adminHistoryQuerySchema,
  assignmentSchema,
  completeSessionSchema,
  correctionSchema,
  createVehicleSchema,
  employeeReportQuerySchema,
  historyQuerySchema,
  recoverSessionSchema,
  reportQuerySchema,
  serviceCreateSchema,
  servicePolicyUpdateSchema,
  serviceReviewParamsSchema,
  serviceReviewSchema,
  sessionIdParamsSchema,
  startSessionSchema,
  transferSchema,
  unassignmentSchema,
  updateVehicleSchema,
  vehicleIdParamsSchema,
  vehicleListQuerySchema,
  vehicleStatusSchema,
  vehicleReportQuerySchema,
} from "./vehicle.validation.js";
import {
  exportEmployeeMileageReport,
  exportVehicleMileageReport,
  getAdminVehicle,
  getAdminVehicleUsageHistory,
  getAdminVehicles,
  getEligibleVehicles,
  getMyCurrentVehicleSession,
  getMyVehicleUsageHistory,
  getVehicleAssignments,
  getVehicleOdometerCorrections,
  getVehicleReminders,
  getVehicleServicePolicy,
  getVehicleServices,
  patchVehicle,
  patchVehicleServicePolicy,
  patchVehicleStatus,
  postVehicle,
  postVehicleAssignment,
  postVehicleOdometerCorrection,
  postVehicleSessionComplete,
  postVehicleSessionRecovery,
  postVehicleSessionStart,
  postVehicleService,
  postVehicleServiceReview,
  postVehicleTransfer,
  postVehicleUnassignment,
} from "./vehicle.controller.js";

const router = Router();
const adminRoles = authorizeRoles("admin", "superAdmin");

router.use(verifyAccessToken);

router.get(
  "/employee/usage/available-vehicles",
  authorizeRoles("employee"),
  getEligibleVehicles,
);
router.get(
  "/employee/usage/current",
  authorizeRoles("employee"),
  getMyCurrentVehicleSession,
);
router.get(
  "/employee/usage/history",
  authorizeRoles("employee"),
  validateRequest(historyQuerySchema, "query"),
  getMyVehicleUsageHistory,
);
router.post(
  "/employee/usage/start",
  authorizeRoles("employee"),
  validateRequest(startSessionSchema),
  requireVehicleIndexes,
  postVehicleSessionStart,
);
router.post(
  "/employee/usage/:sessionId/complete",
  authorizeRoles("employee"),
  validateRequest(sessionIdParamsSchema, "params"),
  validateRequest(completeSessionSchema),
  requireVehicleIndexes,
  postVehicleSessionComplete,
);

router.get(
  "/admin",
  adminRoles,
  validateRequest(vehicleListQuerySchema, "query"),
  getAdminVehicles,
);
router.post(
  "/admin",
  adminRoles,
  validateRequest(createVehicleSchema),
  requireVehicleIndexes,
  postVehicle,
);
router.get("/admin/service-policy", adminRoles, getVehicleServicePolicy);
router.patch(
  "/admin/service-policy",
  adminRoles,
  validateRequest(servicePolicyUpdateSchema),
  requireVehicleIndexes,
  patchVehicleServicePolicy,
);
router.get("/admin/service-reminders", adminRoles, getVehicleReminders);
router.get(
  "/admin/reports/vehicle-export.xlsx",
  adminRoles,
  validateRequest(vehicleReportQuerySchema, "query"),
  exportVehicleMileageReport,
);
router.get(
  "/admin/reports/employee-export.xlsx",
  adminRoles,
  validateRequest(employeeReportQuerySchema, "query"),
  exportEmployeeMileageReport,
);
router.get(
  "/admin/usage/history",
  adminRoles,
  validateRequest(adminHistoryQuerySchema, "query"),
  getAdminVehicleUsageHistory,
);
router.post(
  "/admin/assignments/transfer",
  adminRoles,
  validateRequest(transferSchema),
  requireVehicleIndexes,
  postVehicleTransfer,
);
router.post(
  "/admin/usage/:sessionId/recover",
  adminRoles,
  validateRequest(sessionIdParamsSchema, "params"),
  validateRequest(recoverSessionSchema),
  requireVehicleIndexes,
  postVehicleSessionRecovery,
);

router.get(
  "/admin/:vehicleId/assignments",
  adminRoles,
  validateRequest(vehicleIdParamsSchema, "params"),
  getVehicleAssignments,
);
router.post(
  "/admin/:vehicleId/assignments",
  adminRoles,
  validateRequest(vehicleIdParamsSchema, "params"),
  validateRequest(assignmentSchema),
  requireVehicleIndexes,
  postVehicleAssignment,
);
router.post(
  "/admin/:vehicleId/unassign",
  adminRoles,
  validateRequest(vehicleIdParamsSchema, "params"),
  validateRequest(unassignmentSchema),
  requireVehicleIndexes,
  postVehicleUnassignment,
);
router.get(
  "/admin/:vehicleId/services",
  adminRoles,
  validateRequest(vehicleIdParamsSchema, "params"),
  validateRequest(historyQuerySchema, "query"),
  getVehicleServices,
);
router.post(
  "/admin/:vehicleId/services/:serviceId/review",
  adminRoles,
  validateRequest(serviceReviewParamsSchema, "params"),
  validateRequest(serviceReviewSchema),
  requireVehicleIndexes,
  postVehicleServiceReview,
);
router.post(
  "/admin/:vehicleId/services",
  adminRoles,
  validateRequest(vehicleIdParamsSchema, "params"),
  validateRequest(serviceCreateSchema),
  requireVehicleIndexes,
  postVehicleService,
);
router.get(
  "/admin/:vehicleId/odometer-corrections",
  adminRoles,
  validateRequest(vehicleIdParamsSchema, "params"),
  validateRequest(historyQuerySchema, "query"),
  getVehicleOdometerCorrections,
);
router.post(
  "/admin/:vehicleId/odometer-corrections",
  adminRoles,
  validateRequest(vehicleIdParamsSchema, "params"),
  validateRequest(correctionSchema),
  requireVehicleIndexes,
  postVehicleOdometerCorrection,
);
router.get(
  "/admin/:vehicleId",
  adminRoles,
  validateRequest(vehicleIdParamsSchema, "params"),
  getAdminVehicle,
);
router.patch(
  "/admin/:vehicleId",
  adminRoles,
  validateRequest(vehicleIdParamsSchema, "params"),
  validateRequest(updateVehicleSchema),
  requireVehicleIndexes,
  patchVehicle,
);
router.patch(
  "/admin/:vehicleId/status",
  adminRoles,
  validateRequest(vehicleIdParamsSchema, "params"),
  validateRequest(vehicleStatusSchema),
  requireVehicleIndexes,
  patchVehicleStatus,
);

router.use((req, _res, next) => {
  next(new ApiError(404, "Vehicle route not found"));
});
router.use(vehicleErrorMiddleware);

export default router;
