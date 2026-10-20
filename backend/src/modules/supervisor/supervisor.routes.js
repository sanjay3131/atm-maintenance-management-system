import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import {
  getSupervisedEmployees,
  getSupervisorDashboard,
  getSupervisorEmployeeDetails,
  getSupervisorEmployeeAttendance,
  getSupervisorEmployeeJobs,
  getSupervisorEmployeeAMC,
  getSupervisorJobs,
  getSupervisorJobById,
  getSupervisorJobHistory,
} from "./supervisor.controller.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";
import {
  supervisorAttendanceQuerySchema,
  supervisorAmcQuerySchema,
  supervisorDashboardQuerySchema,
  supervisorEmployeeParamsSchema,
  supervisorEmployeeListQuerySchema,
  supervisorJobQuerySchema,
  supervisorJobParamsSchema,
} from "./supervisor.validation.js";

const router = Router();

router.use(verifyAccessToken, authorizeRoles("supervisor"));

router.get(
  "/employees",
  validateRequest(supervisorEmployeeListQuerySchema, "query"),
  getSupervisedEmployees,
);
router.get(
  "/dashboard",
  validateRequest(supervisorDashboardQuerySchema, "query"),
  getSupervisorDashboard,
);
router.get(
  "/employees/:employeeId",
  validateRequest(supervisorEmployeeParamsSchema, "params"),
  getSupervisorEmployeeDetails,
);
router.get(
  "/employees/:employeeId/attendance",
  validateRequest(supervisorEmployeeParamsSchema, "params"),
  validateRequest(supervisorAttendanceQuerySchema, "query"),
  getSupervisorEmployeeAttendance,
);
router.get(
  "/employees/:employeeId/jobs",
  validateRequest(supervisorEmployeeParamsSchema, "params"),
  validateRequest(supervisorJobQuerySchema, "query"),
  getSupervisorEmployeeJobs,
);
router.get(
  "/employees/:employeeId/amc",
  validateRequest(supervisorEmployeeParamsSchema, "params"),
  validateRequest(supervisorAmcQuerySchema, "query"),
  getSupervisorEmployeeAMC,
);
router.get(
  "/jobs",
  validateRequest(supervisorJobQuerySchema, "query"),
  getSupervisorJobs,
);
router.get(
  "/jobs/:jobId/history",
  validateRequest(supervisorJobParamsSchema, "params"),
  getSupervisorJobHistory,
);
router.get(
  "/jobs/:jobId",
  validateRequest(supervisorJobParamsSchema, "params"),
  getSupervisorJobById,
);

export default router;
