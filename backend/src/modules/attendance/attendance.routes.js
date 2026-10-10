import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";
import { handleAttendanceError } from "./attendanceError.middleware.js";
import {
  attendanceCorrectionSchema,
  attendanceIdParamsSchema,
  attendanceRecordsQuerySchema,
  employeeIdParamsSchema,
  myAttendanceQuerySchema,
  onBehalfAttendanceRecordSchema,
  selfCheckInSchema,
  selfCheckOutSchema,
} from "./attendance.validation.js";
import {
  checkIn,
  checkOut,
  correctAttendanceRecord,
  createEmployeeAttendance,
  getAttendanceById,
  getAttendanceRecords,
  getMyAttendance,
} from "./attendance.controller.js";

const router = Router();

router.post(
  "/me/check-in",
  verifyAccessToken,
  authorizeRoles("employee"),
  validateRequest(selfCheckInSchema),
  checkIn,
);
router.post(
  "/me/check-out",
  verifyAccessToken,
  authorizeRoles("employee"),
  validateRequest(selfCheckOutSchema),
  checkOut,
);
router.get(
  "/me",
  verifyAccessToken,
  authorizeRoles("employee"),
  validateRequest(myAttendanceQuerySchema, "query"),
  getMyAttendance,
);

router.post(
  "/employees/:employeeId/records",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "supervisor"),
  validateRequest(employeeIdParamsSchema, "params"),
  validateRequest(onBehalfAttendanceRecordSchema),
  createEmployeeAttendance,
);

router.get(
  "/records",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "supervisor"),
  validateRequest(attendanceRecordsQuerySchema, "query"),
  getAttendanceRecords,
);
router.get(
  "/records/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "supervisor"),
  validateRequest(attendanceIdParamsSchema, "params"),
  getAttendanceById,
);
router.patch(
  "/records/:id/correction",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(attendanceIdParamsSchema, "params"),
  validateRequest(attendanceCorrectionSchema),
  correctAttendanceRecord,
);

router.use(handleAttendanceError);

export default router;
