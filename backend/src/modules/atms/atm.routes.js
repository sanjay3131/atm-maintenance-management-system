import express from "express";
import {
  assignEmployeeToATM,
  createATM,
  deleteATM,
  getAllATMs,
  getATMById,
  updateATM,
} from "./atm.controller.js";
import {
  createAtmSchema,
  updateAtmSchema,
  validateRequest,
} from "./atm.validation.js";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";

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
  assignEmployeeToATM,
);
export default router;
