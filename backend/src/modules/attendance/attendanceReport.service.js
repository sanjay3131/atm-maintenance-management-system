import Attendance from "./attendance.model.js";
import AttendanceStatusOverride from "./attendanceStatusOverride.model.js";
import PublicHoliday from "../holidays/publicHoliday.model.js";
import {
  attendanceDateOnlySchema,
  isValidAttendanceDate,
} from "./attendance.validation.js";
import { resolveAttendanceStatus } from "./attendanceStatus.js";
import { toAsiaKolkataDateKey } from "../employees/employeeDates.js";
import {
  assertAttendanceExportActive,
  runAttendanceReportQuery,
} from "./attendanceExport.safety.js";

export const MAX_ATTENDANCE_REPORT_DAYS = 366;
export const MAX_ATTENDANCE_REPORT_EMPLOYEES = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_ZONE = "Asia/Kolkata";
const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;
const CHECKOUT_SOURCES = new Set([
  "employee",
  "supervisor",
  "admin",
  "superAdmin",
  "system",
]);

const requireDate = (value, label) => {
  const parsed = attendanceDateOnlySchema.safeParse(value);
  if (!parsed.success) throw new TypeError(`${label} must be a valid YYYY-MM-DD date`);
  return parsed.data;
};

const requireValidTimestamp = (value, label) => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${label} must be a valid Date`);
  }
};

const dateKeyToUtcDay = (dateKey) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.floor(date.getTime() / DAY_MS);
};

const utcDayToDateKey = (utcDay) => {
  const date = new Date(utcDay * DAY_MS);
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
};

const getEmployeeId = (employee) => {
  const id = employee?._id?.toString?.() ?? employee?._id;
  if (typeof id !== "string" || !OBJECT_ID_PATTERN.test(id)) {
    throw new TypeError("Each report employee must have a valid MongoDB _id");
  }
  return id.toLowerCase();
};

const addUnique = (map, key, value, label) => {
  if (map.has(key)) throw new TypeError(`Duplicate ${label} for ${key}`);
  map.set(key, value);
};

const employeeDateKey = (date, label) => {
  requireValidTimestamp(date, label);
  return toAsiaKolkataDateKey(date);
};

const validateEmployee = (employee) => {
  const employeeId = getEmployeeId(employee);
  const joiningDate = employeeDateKey(employee.joiningDate, "joiningDate");
  const effectiveExitDate =
    employee.effectiveExitDate == null
      ? null
      : employeeDateKey(employee.effectiveExitDate, "effectiveExitDate");
  if (effectiveExitDate && effectiveExitDate < joiningDate) {
    throw new RangeError(
      `Employee ${employeeId} has effectiveExitDate before joiningDate`,
    );
  }
  return { employeeId, joiningDate, effectiveExitDate };
};

const validateAttendanceRecord = (record, employeeIds, fromDate, throughDate) => {
  const employeeId = (
    record.employeeId?.toString?.() ?? record.employeeId
  )?.toLowerCase();
  if (typeof employeeId !== "string" || !employeeIds.has(employeeId)) {
    throw new TypeError("Attendance record references an employee outside the report");
  }
  if (
    !isValidAttendanceDate(record.attendanceDate) ||
    record.attendanceDate < fromDate ||
    record.attendanceDate > throughDate
  ) {
    throw new TypeError("Attendance record contains an invalid or out-of-range date");
  }
  requireValidTimestamp(record.checkInAt, "Attendance checkInAt");
  if (record.checkOutAt != null) {
    requireValidTimestamp(record.checkOutAt, "Attendance checkOutAt");
    if (record.checkOutAt < record.checkInAt) {
      throw new RangeError("Attendance checkOutAt cannot be earlier than checkInAt");
    }
    if (!CHECKOUT_SOURCES.has(record.checkOutSource)) {
      throw new TypeError("Attendance checkOutSource is invalid");
    }
    if (
      record.checkOutSource === "system" &&
      record.checkOutRecordedBy != null
    ) {
      throw new TypeError(
        "System attendance checkout cannot have a human recorder",
      );
    }
  } else if (record.checkOutSource != null) {
    throw new TypeError("Open attendance cannot have a checkOutSource");
  }
  return `${employeeId}:${record.attendanceDate}`;
};

const validateOverride = (override, employeeIds, fromDate, throughDate) => {
  const employeeId = (
    override.employeeId?.toString?.() ?? override.employeeId
  )?.toLowerCase();
  if (typeof employeeId !== "string" || !employeeIds.has(employeeId)) {
    throw new TypeError("Attendance override references an employee outside the report");
  }
  if (
    !isValidAttendanceDate(override.attendanceDate) ||
    override.attendanceDate < fromDate ||
    override.attendanceDate > throughDate
  ) {
    throw new TypeError("Attendance override contains an invalid or out-of-range date");
  }
  if (!["present", "absent"].includes(override.status)) {
    throw new TypeError("Attendance override contains an invalid status");
  }
  return `${employeeId}:${override.attendanceDate}`;
};

const fetchReportInputs = async ({
  employeeIds,
  fromDate,
  throughDate,
  signal,
  deadline,
}) => {
  const dateRange = { $gte: fromDate, $lte: throughDate };
  const ids = [...employeeIds];
  const [holidays, attendanceRecords, overrides] = await Promise.all([
    runAttendanceReportQuery(
      PublicHoliday.find({ date: dateRange }).select("date"),
      { signal, deadline },
    ),
    runAttendanceReportQuery(
      Attendance.find({
        employeeId: { $in: ids },
        attendanceDate: dateRange,
      }).select(
        "employeeId attendanceDate checkInAt checkOutAt checkOutSource checkOutRecordedBy",
      ),
      { signal, deadline },
    ),
    runAttendanceReportQuery(
      AttendanceStatusOverride.find({
        employeeId: { $in: ids },
        attendanceDate: dateRange,
      }).select("employeeId attendanceDate status"),
      { signal, deadline },
    ),
  ]);
  assertAttendanceExportActive({ signal, deadline });
  return { holidays, attendanceRecords, overrides };
};

/**
 * Calculate bounded attendance reports for a fixed date range and asOf time.
 * The employees array is limited to 100; callers with larger selections must
 * batch employees across calls, keeping the same date range and asOf timestamp.
 */
export const calculateAttendanceReports = async ({
  employees,
  fromDate: requestedFromDate,
  toDate: requestedToDate,
  asOf = new Date(),
  signal,
  deadline,
}) => {
  assertAttendanceExportActive({ signal, deadline });
  if (!Array.isArray(employees)) {
    throw new TypeError("employees must be an array");
  }
  if (employees.length > MAX_ATTENDANCE_REPORT_EMPLOYEES) {
    throw new RangeError(
      `Attendance reports support at most ${MAX_ATTENDANCE_REPORT_EMPLOYEES} employees per calculation`,
    );
  }

  const fromDate = requireDate(requestedFromDate, "fromDate");
  const toDate = requireDate(requestedToDate, "toDate");
  if (fromDate > toDate) throw new RangeError("fromDate must be on or before toDate");
  if (
    dateKeyToUtcDay(toDate) - dateKeyToUtcDay(fromDate) + 1 >
    MAX_ATTENDANCE_REPORT_DAYS
  ) {
    throw new RangeError(
      `Attendance report range cannot exceed ${MAX_ATTENDANCE_REPORT_DAYS} calendar days`,
    );
  }
  requireValidTimestamp(asOf, "asOf");
  const fixedAsOf = new Date(asOf.getTime());
  const asOfDate = toAsiaKolkataDateKey(fixedAsOf);
  const throughDate = toDate < asOfDate ? toDate : asOfDate;

  const employeeInfo = employees.map(validateEmployee);
  const employeeIds = new Set(employeeInfo.map(({ employeeId }) => employeeId));
  if (employeeIds.size !== employeeInfo.length) {
    throw new TypeError("Duplicate employee in attendance report input");
  }

  const { holidays, attendanceRecords, overrides } = await fetchReportInputs({
    employeeIds,
    fromDate,
    throughDate,
    signal,
    deadline,
  });
  assertAttendanceExportActive({ signal, deadline });

  const holidayDates = new Set();
  for (const holiday of holidays) {
    if (!isValidAttendanceDate(holiday.date)) {
      throw new TypeError("Public holiday contains an invalid date");
    }
    if (holiday.date < fromDate || holiday.date > throughDate) {
      throw new TypeError("Public holiday query returned an out-of-range date");
    }
    if (holidayDates.has(holiday.date)) {
      throw new TypeError(`Duplicate public holiday date for ${holiday.date}`);
    }
    holidayDates.add(holiday.date);
  }

  const attendanceByKey = new Map();
  for (const record of attendanceRecords) {
    const key = validateAttendanceRecord(
      record,
      employeeIds,
      fromDate,
      throughDate,
    );
    addUnique(attendanceByKey, key, record, "attendance record");
  }

  const overrideByKey = new Map();
  for (const override of overrides) {
    const key = validateOverride(override, employeeIds, fromDate, throughDate);
    addUnique(overrideByKey, key, override, "attendance override");
  }

  const reports = employeeInfo.map((info, employeeIndex) => {
    assertAttendanceExportActive({ signal, deadline });
    const employee = employees[employeeIndex];
    const summary = {
      eligibleWorkingDays: 0,
      presentDays: 0,
      incompleteDays: 0,
      absentDays: 0,
      notRecordedDays: 0,
      attendancePercentage: null,
      workedDurationMs: 0,
      finalizedWorkedDurationMs: 0,
      provisionalWorkedDurationMs: 0,
    };
    const dailyDetails = [];
    const startDay = Math.max(
      dateKeyToUtcDay(fromDate),
      dateKeyToUtcDay(info.joiningDate),
    );
    const endDay = Math.min(
      dateKeyToUtcDay(throughDate),
      info.effectiveExitDate
        ? dateKeyToUtcDay(info.effectiveExitDate)
        : dateKeyToUtcDay(throughDate),
    );

    for (let day = startDay; day <= endDay; day += 1) {
      if ((day - startDay) % 32 === 0) {
        assertAttendanceExportActive({ signal, deadline });
      }
      const attendanceDate = utcDayToDateKey(day);
      if (holidayDates.has(attendanceDate)) continue;

      summary.eligibleWorkingDays += 1;
      const key = `${info.employeeId}:${attendanceDate}`;
      const record = attendanceByKey.get(key) ?? null;
      const override = overrideByKey.get(key) ?? null;
      const resolved = resolveAttendanceStatus({
        record,
        override,
        asOf: fixedAsOf,
      });
      const status =
        resolved.effectiveStatus === "unrecorded"
          ? "not_recorded"
          : resolved.effectiveStatus;
      if (status === "present") summary.presentDays += 1;
      else if (status === "incomplete") summary.incompleteDays += 1;
      else if (status === "absent") summary.absentDays += 1;
      else if (status === "not_recorded") summary.notRecordedDays += 1;
      else throw new TypeError(`Unsupported attendance status: ${status}`);

      const isProvisional = Boolean(record && record.checkOutAt == null);
      const workedDurationMs = resolved.workedDurationMs ?? 0;
      summary.workedDurationMs += workedDurationMs;
      if (isProvisional) {
        summary.provisionalWorkedDurationMs += workedDurationMs;
      } else if (record) {
        summary.finalizedWorkedDurationMs += workedDurationMs;
      }

      dailyDetails.push({
        attendanceDate,
        status,
        calculatedStatus: resolved.calculatedStatus,
        statusOrigin: resolved.statusOrigin,
        checkInAt: record?.checkInAt ?? null,
        checkOutAt: record?.checkOutAt ?? null,
        checkoutState: record
          ? record.checkOutAt == null
            ? "not_checked_out"
            : "checked_out"
          : "no_record",
        checkOutSource: record?.checkOutSource ?? null,
        workedDurationMs: record ? workedDurationMs : null,
        durationIsProvisional: isProvisional,
      });
    }

    summary.attendancePercentage =
      summary.eligibleWorkingDays === 0
        ? null
        : Number(
            (
              (summary.presentDays / summary.eligibleWorkingDays) *
              100
            ).toFixed(2),
          );
    return {
      employeeId: info.employeeId,
      summary,
      dailyDetails,
    };
  });

  assertAttendanceExportActive({ signal, deadline });
  return {
    timeZone: TIME_ZONE,
    asOf: fixedAsOf,
    period: {
      fromDate,
      toDate,
      calculatedThroughDate: throughDate < fromDate ? null : throughDate,
    },
    employees: reports,
  };
};
