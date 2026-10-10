import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import {
  checkInForEmployee,
  checkOutForEmployee,
  correctAttendance,
  getAttendanceRecord,
  listAttendanceRecords,
  listMyAttendance,
  recordAttendanceForEmployee,
} from "./attendance.service.js";

export const checkIn = asyncHandler(async (req, res) => {
  const attendance = await checkInForEmployee(req.user);
  return res
    .status(201)
    .json(new ApiResponse(201, attendance, "Attendance check-in recorded"));
});

export const checkOut = asyncHandler(async (req, res) => {
  const attendance = await checkOutForEmployee(req.user);
  return res
    .status(200)
    .json(new ApiResponse(200, attendance, "Attendance check-out recorded"));
});

export const getMyAttendance = asyncHandler(async (req, res) => {
  const result = await listMyAttendance(req.user, req.validatedQuery);
  return res
    .status(200)
    .json(new ApiResponse(200, result, "Attendance history fetched"));
});

export const createEmployeeAttendance = asyncHandler(async (req, res) => {
  const result = await recordAttendanceForEmployee({
    employeeId: req.validatedParams.employeeId,
    actor: req.user,
    checkInAt: req.body.checkInAt,
    checkOutAt: req.body.checkOutAt,
    reason: req.body.reason,
  });
  return res
    .status(201)
    .json(new ApiResponse(201, result, "Attendance record created"));
});

export const getAttendanceRecords = asyncHandler(async (req, res) => {
  const result = await listAttendanceRecords(req.user, req.validatedQuery);
  return res
    .status(200)
    .json(new ApiResponse(200, result, "Attendance records fetched"));
});

export const getAttendanceById = asyncHandler(async (req, res) => {
  const attendance = await getAttendanceRecord(
    req.validatedParams.id,
    req.user,
  );
  return res
    .status(200)
    .json(new ApiResponse(200, attendance, "Attendance record fetched"));
});

export const correctAttendanceRecord = asyncHandler(async (req, res) => {
  const result = await correctAttendance({
    attendanceId: req.validatedParams.id,
    actor: req.user,
    reason: req.body.reason,
    checkInAt: req.body.checkInAt,
    checkOutAt: req.body.checkOutAt,
    attendanceDate: req.body.attendanceDate,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, result, "Attendance record corrected"));
});
