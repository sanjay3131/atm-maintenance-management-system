import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import {
  getSupervisedEmployees,
  getSupervisorDashboard,
  getEmployeeAMCProgress,
} from "./supervisor.controller.js";

const router = Router();

router.use(verifyAccessToken, authorizeRoles("supervisor"));

router.get("/employees", getSupervisedEmployees);
router.get("/dashboard", getSupervisorDashboard);
router.get("/employees/:employeeId/amc", getEmployeeAMCProgress);

export default router;
