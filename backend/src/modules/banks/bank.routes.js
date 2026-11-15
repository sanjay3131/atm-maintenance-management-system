import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";
import {
  createBankSchema,
  updateBankSchema,
} from "./bank.validation.js";
import { z } from "zod";
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

const bankIdParamsSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid bank ID"),
});

router.post("/", validateRequest(createBankSchema), createBank);
router.get("/", getAllBanks);
router.get("/:id", validateRequest(bankIdParamsSchema, "params"), getBankById);
router.put(
  "/:id",
  validateRequest(bankIdParamsSchema, "params"),
  validateRequest(updateBankSchema),
  updateBank,
);
router.delete("/:id", validateRequest(bankIdParamsSchema, "params"), deleteBank);

export default router;
