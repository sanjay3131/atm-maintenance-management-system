import express from "express";

import {
  getAllUsers,
  getSupervisors,
  getUserById,
  updateUserById,
  //   deleteUserById,
  assignRoleToUser,
  changeUserStatus,
  createEmployeeUser,
  createUserWizard,
  createCustomerUserWizard,
  createSupervisor,
  getSupervisorManagementDetails,
  getSupervisorManagementList,
  updateSupervisor,
  updateSupervisorStatus,
} from "./user.controller.js";

import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import {
  createCustomerUserWizardSchema,
  createUserWizardSchema,
} from "./user-wizard.validate.js";
import {
  assignRoleSchema,
  changeUserStatusSchema,
  updateUserSchema,
  validateRequest,
  createEmployeeUserSchema,
  createSupervisorSchema,
  updateSupervisorSchema,
  supervisorManagementQuerySchema,
  supervisorIdParamsSchema,
  supervisorStatusSchema,
} from "./user.validate.js";
import { validateRequest as validate } from "../../middlewares/validate.middleware.js";

const router = express.Router();
// get all users
router.get(
  "/supervisors",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getSupervisors,
);
router.get(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getAllUsers,
);
// create employee user
router.post(
  "/create-employee",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(createEmployeeUserSchema),
  createEmployeeUser,
);

router.post(
  "/wizard",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(createUserWizardSchema),
  createUserWizard,
);
router.post(
  "/wizard/customer",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(createCustomerUserWizardSchema),
  createCustomerUserWizard,
);

router.get(
  "/supervisor-management",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validate(supervisorManagementQuerySchema, "query"),
  getSupervisorManagementList,
);
router.post(
  "/supervisor-management",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(createSupervisorSchema),
  createSupervisor,
);
router.get(
  "/supervisor-management/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validate(supervisorIdParamsSchema, "params"),
  getSupervisorManagementDetails,
);
router.put(
  "/supervisor-management/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validate(supervisorIdParamsSchema, "params"),
  validateRequest(updateSupervisorSchema),
  updateSupervisor,
);
router.patch(
  "/supervisor-management/:id/status",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validate(supervisorIdParamsSchema, "params"),
  validateRequest(supervisorStatusSchema),
  updateSupervisorStatus,
);

// get user by id
router.get(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getUserById,
);

// update user by id
router.put(
  "/:id",
  verifyAccessToken,
  validateRequest(updateUserSchema),
  authorizeRoles("admin", "superAdmin", "employee"),
  updateUserById,
);

// assign role to user
router.put(
  "/:id/assign-role",
  verifyAccessToken,
  validateRequest(assignRoleSchema),
  authorizeRoles("admin", "superAdmin"),
  assignRoleToUser,
);

// change user status
router.put(
  "/:id/change-status",
  verifyAccessToken,
  validateRequest(changeUserStatusSchema),
  authorizeRoles("admin", "superAdmin"),
  changeUserStatus,
);

export default router;
