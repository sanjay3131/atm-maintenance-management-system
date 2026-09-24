import express from "express";

import {
  getAllUsers,
  getUserById,
  updateUserById,
  //   deleteUserById,
  assignRoleToUser,
  changeUserStatus,
  createEmployeeUser,
  createUserWizard,
} from "./user.controller.js";

import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { createUserWizardSchema } from "./user-wizard.validate.js";
import {
  assignRoleSchema,
  changeUserStatusSchema,
  updateUserSchema,
  validateRequest,
  createEmployeeUserSchema,
} from "./user.validate.js";

const router = express.Router();
// get all users
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
