import express from "express";
import {
  createEmployee,
  updateEmployee,
  viewAllEmployees,
  viewEmployeeById,
} from "./employee.controller.js";
import {
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

export default router;
