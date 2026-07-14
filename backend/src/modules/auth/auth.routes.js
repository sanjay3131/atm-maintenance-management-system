import { Router } from "express";
import {
  getCurrentUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  registerUser,
} from "./auth.controller.js";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import {
  loginSchema,
  refreshSchema,
  registerSchema,
  validateRequest,
} from "./auth.validation.js";

const router = Router();

router.post("/register", validateRequest(registerSchema), registerUser);
router.post("/login", validateRequest(loginSchema), loginUser);
router.post("/refresh", refreshAccessToken);
router.post("/logout", logoutUser);
router.get("/me", verifyAccessToken, getCurrentUser);

export default router;
