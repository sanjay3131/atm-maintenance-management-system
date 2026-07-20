import express from "express";
import { createATM } from "./atm.controller.js";
import { createAtmSchema, validateRequest } from "./atm.validation.js";
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

export default router;
