import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import {
  createBank,
  getAllBanks,
  getBankById,
  updateBank,
  deleteBank,
} from "./bank.controller.js";

const router = Router();

// All routes require admin/superAdmin
router.use(verifyAccessToken, authorizeRoles("admin", "superAdmin"));

router.post("/", createBank);
router.get("/", getAllBanks);
router.get("/:id", getBankById);
router.put("/:id", updateBank);
router.delete("/:id", deleteBank);

export default router;
