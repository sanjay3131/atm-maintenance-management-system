import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from "./notification.controller.js";

const router = Router();

router.get("/", verifyAccessToken, getMyNotifications);
router.put("/:id/read", verifyAccessToken, markAsRead);
router.put("/read-all", verifyAccessToken, markAllAsRead);
router.delete("/:id", verifyAccessToken, deleteNotification);

export default router;
