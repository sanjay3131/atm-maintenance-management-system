import Employee from "../employees/employee.model.js";
import { calculateAttendanceReports } from "./attendanceReport.service.js";
import ApiError from "../../utils/ApiError.js";
import {
  assertAttendanceExportActive,
  runAttendanceReportQuery,
} from "./attendanceExport.safety.js";

const TIME_ZONE = "Asia/Kolkata";
const EMPLOYEE_REPORT_FIELDS =
  "_id employeeCode joiningDate effectiveExitDate";
const EMPLOYEE_EXPORT_FIELDS =
  "_id employeeCode joiningDate effectiveExitDate userId";
const EMPLOYEE_REPORT_BATCH_SIZE = 100;

const employeeName = (employee) =>
  [employee.userId?.firstName, employee.userId?.lastName]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ")
    .trim();

const addEmployeeIdentity = (report, employees, includeName = false) => {
  const employeeById = new Map(
    employees.map((employee) => [
      String(employee._id).toLowerCase(),
      employee,
    ]),
  );
  return report.employees.map((employeeReport) => {
    const employee = employeeById.get(
      String(employeeReport.employeeId).toLowerCase(),
    );
    if (!employee) {
      throw new Error(
        "Attendance report calculator returned an unselected employee",
      );
    }
    return {
      ...employeeReport,
      employeeCode: employee.employeeCode ?? null,
      ...(includeName ? { employeeName: employeeName(employee) || null } : {}),
    };
  });
};

export const getAttendanceReport = async ({
  fromDate,
  toDate,
  page,
  limit,
  employeeId,
  asOf,
}) => {
  const filter = employeeId ? { _id: employeeId } : {};
  const skip = (page - 1) * limit;
  const fixedAsOf = asOf ?? new Date();
  const [employees, totalEmployees] = await Promise.all([
    Employee.find(filter)
      .select(EMPLOYEE_REPORT_FIELDS)
      .sort({ _id: 1 })
      .skip(skip)
      .limit(limit),
    Employee.countDocuments(filter),
  ]);
  const pagination = {
    page,
    limit,
    totalEmployees,
    totalPages: Math.ceil(totalEmployees / limit),
  };

  if (employees.length === 0) {
    return {
      timeZone: TIME_ZONE,
      asOf: fixedAsOf,
      period: {
        fromDate,
        toDate,
        calculatedThroughDate: null,
      },
      pagination,
      employees: [],
    };
  }

  const report = await calculateAttendanceReports({
    employees,
    fromDate,
    toDate,
    asOf: fixedAsOf,
  });
  const reportEmployees = addEmployeeIdentity(report, employees);

  return {
    timeZone: report.timeZone,
    asOf: report.asOf,
    period: report.period,
    pagination,
    employees: reportEmployees,
  };
};

export const MAX_ATTENDANCE_EXPORT_EMPLOYEES = 1_000;

export const createCompleteAttendanceReport = async ({
  fromDate,
  toDate,
  employeeId,
  asOf,
  signal,
  deadline,
}) => {
  const fixedAsOf = new Date(asOf.getTime());
  const baseFilter = employeeId ? { _id: employeeId } : {};
  assertAttendanceExportActive({ signal, deadline });
  const totalEmployees = await runAttendanceReportQuery(
    Employee.countDocuments(baseFilter),
    { signal, deadline },
  );
  if (totalEmployees > MAX_ATTENDANCE_EXPORT_EMPLOYEES) {
    throw new ApiError(
      413,
      `Attendance export supports at most ${MAX_ATTENDANCE_EXPORT_EMPLOYEES} employees`,
    );
  }

  let highWaterId = null;
  if (totalEmployees > 0 && !employeeId) {
    const [lastEmployee] = await runAttendanceReportQuery(
      Employee.find(baseFilter)
        .select("_id")
        .sort({ _id: -1 })
        .limit(1),
      { signal, deadline },
    );
    highWaterId = lastEmployee?._id ?? null;
  }

  assertAttendanceExportActive({ signal, deadline });
  const emptyReport = await calculateAttendanceReports({
    employees: [],
    fromDate,
    toDate,
    asOf: fixedAsOf,
    signal,
    deadline,
  });

  const batches = async function* (assertActiveCallback = () => {}) {
    const assertActive = () => {
      assertAttendanceExportActive({ signal, deadline });
      assertActiveCallback();
    };
    let lastEmployeeId = null;
    let processed = 0;
    while (processed < totalEmployees) {
      assertActive();
      const filter = employeeId
        ? { _id: employeeId }
        : {
            _id: {
              ...(lastEmployeeId ? { $gt: lastEmployeeId } : {}),
              $lte: highWaterId,
            },
          };
      const employees = await runAttendanceReportQuery(
        Employee.find(filter)
          .select(EMPLOYEE_EXPORT_FIELDS)
          .populate("userId", "firstName lastName")
          .sort({ _id: 1 })
          .limit(Math.min(
            EMPLOYEE_REPORT_BATCH_SIZE,
            totalEmployees - processed,
          )),
        { signal, deadline },
      );
      assertActive();
      if (employees.length === 0) break;

      const report = await calculateAttendanceReports({
        employees,
        fromDate,
        toDate,
        asOf: fixedAsOf,
        signal,
        deadline,
      });
      processed += employees.length;
      lastEmployeeId = employees.at(-1)._id;
      assertActive();
      yield {
        ...report,
        employees: addEmployeeIdentity(report, employees, true),
      };
    }

    if (processed !== totalEmployees) {
      throw new Error(
        "The employee collection changed during export; a complete report could not be guaranteed",
      );
    }
  };

  return {
    timeZone: TIME_ZONE,
    asOf: fixedAsOf,
    period: emptyReport.period,
    totalEmployees,
    batches,
  };
};
