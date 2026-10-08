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
} from "./atm.controller.js";
import {
  createAtmSchema,
  updateAtmSchema,
  assignATMEmployeeSchema,
  setATMAMCResponsibleEmployeeSchema,
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
