import express from "express";
import {
  assignAtms,
  assignDistricts,
  createEmployee,
  updateEmployee,
  viewAllEmployees,
  viewEmployeeById,
} from "./employee.controller.js";
import {
  assignATMsSchema,
  assignDistrictsSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
  validateRequest,
} from "./employee.validate.js";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";

const router = express.Router();

// create employee
router.post(
  "/create/:userId",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(createEmployeeSchema),
  createEmployee,
);

// update employee
router.patch(
  "/update/:employeeId",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(updateEmployeeSchema),
  updateEmployee,
);

// view employee by id
router.get(
  "/:employeeId",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  viewEmployeeById,
);

// view all employees
router.get(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  viewAllEmployees,
);

// assign ATMs to employee
router.post(
  "/assign-atms/:employeeId",
  verifyAccessToken,
  validateRequest(assignATMsSchema),

  authorizeRoles("admin", "superAdmin"),
  assignAtms,
);

// assign districts to employee
router.post(
  "/assign-districts/:employeeId",
  verifyAccessToken,
  validateRequest(assignDistrictsSchema),
  authorizeRoles("admin", "superAdmin"),
  assignDistricts,
);

export default router;
