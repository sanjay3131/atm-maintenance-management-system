import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";
import {
  createItem,
  getAllItems,
  getItemById,
  updateItem,
} from "./item.controller.js";
import { createItemSchema, updateItemSchema } from "./item.validation.js";
import { requireItemNameIndex } from "./itemIndexReadiness.js";

const router = Router();

router.use(verifyAccessToken);

router.post(
  "/",
  authorizeRoles("admin", "superAdmin"),
  validateRequest(createItemSchema),
  requireItemNameIndex,
  createItem,
);
router.get("/", authorizeRoles("admin", "superAdmin", "employee"), getAllItems);
router.get("/:id", authorizeRoles("admin", "superAdmin"), getItemById);
router.put(
  "/:id",
  authorizeRoles("admin", "superAdmin"),
  validateRequest(updateItemSchema),
  requireItemNameIndex,
  updateItem,
);

export default router;
