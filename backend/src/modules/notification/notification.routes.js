import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";
import {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from "./notification.controller.js";
import {
  notificationIdParamsSchema,
  notificationListQuerySchema,
} from "./notification.validation.js";

const router = Router();

router.get(
  "/",
  verifyAccessToken,
  validateRequest(notificationListQuerySchema, "query"),
  getMyNotifications,
);
router.get("/unread-count", verifyAccessToken, getUnreadCount);
router.put("/read-all", verifyAccessToken, markAllAsRead);
router.put(
  "/:id/read",
  verifyAccessToken,
  validateRequest(notificationIdParamsSchema, "params"),
  markAsRead,
);
router.delete(
  "/:id",
  verifyAccessToken,
  validateRequest(notificationIdParamsSchema, "params"),
  deleteNotification,
);

export default router;
