import mongoose from "mongoose";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ApiError from "../../utils/ApiError.js";
import ATM from "../atms/atm.model.js";
import Bank from "../banks/bank.model.js";
import CleaningRecord from "./cleaningRecord.model.js";
import {
  getCleaningMonitoringRecords,
} from "./cleaningMonitoring.service.js";
import District from "../districts/district.models.js";
import Employee from "../employees/employee.model.js";
import Job from "../jobs/jobs.model.js";
import {
  getBusinessDayStart,
} from "../jobs/recurringMaintenance.utils.js";
import RecurringMaintenancePlan from "../jobs/recurringMaintenancePlan.model.js";
import Region from "../region/region.model.js";
import User from "../users/user.model.js";
import {
  MAX_CLEANING_EXPORT_DAYS,
} from "./cleaningExport.validation.js";
import { writeRecurringCleaningWorkbook } from "./cleaningExport.excel.js";

const DAY_IN_MILLISECONDS = 86_400_000;
const EXPORT_TIMEOUT_MS = 120_000;
const EXPORT_QUERY_TIMEOUT_MS = 15_000;
const EXPORT_MAX_BYTES = 64 * 1024 * 1024;
const EXPORT_MAX_ROWS = 1_048_575;
const CURSOR_BATCH_SIZE = 200;
const CLEANING_TYPES = ["DAILY_CLEANING", "WEEKLY_MOPPING"];

let activeExports = 0;
const activeUsers = new Set();

const asObjectId = (id) => new mongoose.Types.ObjectId(id);
const idString = (id) => (id == null ? "" : String(id));

export const assertCleaningExportActive = ({ signal, deadline }) => {
  if (signal?.aborted) {
    throw new ApiError(499, "Cleaning export was cancelled");
  }
  if (Date.now() >= deadline) {
    throw new ApiError(504, "Cleaning export exceeded its time limit");
  }
};

export const withCleaningExportSlot = async (userId, operation) => {
  const key = String(userId ?? "");
  if (!key || activeUsers.has(key)) {
    throw new ApiError(429, "A cleaning export is already running for this user");
  }
  if (activeExports >= 1) {
    throw new ApiError(429, "Cleaning export capacity is currently full");
  }

  activeExports += 1;
  activeUsers.add(key);
  try {
    return await operation();
  } finally {
    activeUsers.delete(key);
    activeExports -= 1;
  }
};

export const getMonitoringPlanIdsForStatus = (records, status) =>
  records
    .filter((record) => record.status === status)
    .map((record) => asObjectId(record.planId));

const getQueryTimeLimit = (deadline) => {
  const remainingMs = deadline - Date.now();
  const maxTimeMS = Math.floor(
    Math.min(EXPORT_QUERY_TIMEOUT_MS, remainingMs),
  );
  if (maxTimeMS < 1) {
    throw new ApiError(504, "Cleaning export exceeded its time limit");
  }
  return maxTimeMS;
};

const resolveEmployeeUserId = async (employeeId, deadline) => {
  if (!employeeId) return null;
  assertCleaningExportActive({ deadline });
  const employee = await Employee.findById(employeeId)
    .select("userId")
    .maxTimeMS(getQueryTimeLimit(deadline))
    .lean();
  assertCleaningExportActive({ deadline });
  return employee?.userId ?? null;
};

export const buildScheduledJobsPipeline = ({
  filters,
  employeeUserId,
  monitoringPlanIds,
}) => {
  const from = getBusinessDayStart(filters.fromDate);
  const toExclusive = new Date(
    getBusinessDayStart(filters.toDate).getTime() + DAY_IN_MILLISECONDS,
  );
  const pipeline = [
    {
      $match: {
        isDeleted: { $ne: true },
        "recurringMaintenance.source": "RECURRING",
        "recurringMaintenance.scheduledDate": {
          $gte: from,
          $lt: toExclusive,
        },
      },
    },
    { $sort: { "recurringMaintenance.scheduledDate": 1, _id: 1 } },
    {
      $lookup: {
        from: RecurringMaintenancePlan.collection.name,
        localField: "recurringMaintenance.planId",
        foreignField: "_id",
        as: "recurringPlan",
      },
    },
    {
      $unwind: {
        path: "$recurringPlan",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: ATM.collection.name,
        localField: "atmId",
        foreignField: "_id",
        as: "currentATM",
      },
    },
    {
      $unwind: {
        path: "$currentATM",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $set: {
        _exportBankId: {
          $ifNull: ["$geographySnapshot.bankId", "$currentATM.bankId"],
        },
        _exportRegionId: {
          $ifNull: ["$geographySnapshot.regionId", "$currentATM.regionId"],
        },
        _exportDistrictId: {
          $ifNull: [
            "$geographySnapshot.districtId",
            "$currentATM.districtId",
          ],
        },
      },
    },
  ];

  if (filters.maintenanceType) {
    pipeline.push({
      $match: {
        "recurringMaintenance.maintenanceType": filters.maintenanceType,
      },
    });
  }
  if (filters.bankId) {
    pipeline.push({ $match: { _exportBankId: asObjectId(filters.bankId) } });
  }
  if (filters.regionId) {
    pipeline.push({ $match: { _exportRegionId: asObjectId(filters.regionId) } });
  }
  if (filters.districtId) {
    pipeline.push({
      $match: { _exportDistrictId: asObjectId(filters.districtId) },
    });
  }
  if (filters.employeeId) {
    const assignedTo = [{ "recurringPlan.assignedEmployeeId": asObjectId(filters.employeeId) }];
    if (employeeUserId) {
      assignedTo.push({ assignedEmployeeId: employeeUserId });
    }
    pipeline.push({ $match: { $or: assignedTo } });
  }
  if (filters.monitoringStatus) {
    pipeline.push({
      $match: {
        "recurringMaintenance.planId": { $in: monitoringPlanIds },
      },
    });
  }

  pipeline.push(
    {
      $lookup: {
        from: CleaningRecord.collection.name,
        let: {
          recurringJobId: "$_id",
          recurringPlanId: "$recurringMaintenance.planId",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$recurringJobId", "$$recurringJobId"] },
                  { $eq: ["$recurringPlanId", "$$recurringPlanId"] },
                ],
              },
            },
          },
        ],
        as: "cleaningRecord",
      },
    },
    {
      $unwind: {
        path: "$cleaningRecord",
        preserveNullAndEmptyArrays: true,
      },
    },
  );

  const appendEmployeeDetails = (employeeIdPath, prefix) => {
    pipeline.push(
      {
        $lookup: {
          from: Employee.collection.name,
          localField: employeeIdPath,
          foreignField: "_id",
          as: prefix,
        },
      },
      {
        $unwind: {
          path: `$${prefix}`,
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: User.collection.name,
          localField: `${prefix}.userId`,
          foreignField: "_id",
          as: `${prefix}User`,
        },
      },
      {
        $unwind: {
          path: `$${prefix}User`,
          preserveNullAndEmptyArrays: true,
        },
      },
    );
  };

  appendEmployeeDetails(
    "recurringPlan.assignedEmployeeId",
    "planAssignedEmployee",
  );
  pipeline.push(
    {
      $lookup: {
        from: User.collection.name,
        localField: "assignedEmployeeId",
        foreignField: "_id",
        as: "occurrenceAssignedUser",
      },
    },
    {
      $unwind: {
        path: "$occurrenceAssignedUser",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: Employee.collection.name,
        localField: "assignedEmployeeId",
        foreignField: "userId",
        as: "occurrenceAssignedEmployee",
      },
    },
    {
      $unwind: {
        path: "$occurrenceAssignedEmployee",
        preserveNullAndEmptyArrays: true,
      },
    },
  );
  appendEmployeeDetails(
    "cleaningRecord.actualCleanerEmployeeId",
    "actualCleanerEmployee",
  );
  appendEmployeeDetails(
    "cleaningRecord.responsibleEmployeeId",
    "reportingEmployee",
  );

  pipeline.push(
    {
      $lookup: {
        from: Bank.collection.name,
        localField: "_exportBankId",
        foreignField: "_id",
        as: "currentBank",
      },
    },
    {
      $unwind: {
        path: "$currentBank",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: Region.collection.name,
        localField: "_exportRegionId",
        foreignField: "_id",
        as: "currentRegion",
      },
    },
    {
      $unwind: {
        path: "$currentRegion",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: District.collection.name,
        localField: "_exportDistrictId",
        foreignField: "_id",
        as: "currentDistrict",
      },
    },
    {
      $unwind: {
        path: "$currentDistrict",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 1,
        jobId: 1,
        status: 1,
        assignedEmployeeId: 1,
        recurringMaintenance: 1,
        geographySnapshot: 1,
        currentATM: {
          _id: "$currentATM._id",
          atmId: "$currentATM.atmId",
          clientAtmId: "$currentATM.clientAtmId",
          locationName: "$currentATM.locationName",
          address: "$currentATM.address",
          bankId: "$currentATM.bankId",
          regionId: "$currentATM.regionId",
          districtId: "$currentATM.districtId",
        },
        currentBank: { bankName: "$currentBank.bankName" },
        currentRegion: { name: "$currentRegion.name" },
        currentDistrict: { districtName: "$currentDistrict.districtName" },
        recurringPlan: {
          _id: "$recurringPlan._id",
          assignedEmployeeId: "$recurringPlan.assignedEmployeeId",
          maintenanceType: "$recurringPlan.maintenanceType",
          dayOfWeek: "$recurringPlan.dayOfWeek",
          startDate: "$recurringPlan.startDate",
          isActive: "$recurringPlan.isActive",
        },
        planAssignedEmployee: {
          employeeCode: "$planAssignedEmployee.employeeCode",
          firstName: "$planAssignedEmployeeUser.firstName",
          lastName: "$planAssignedEmployeeUser.lastName",
        },
        occurrenceAssignedEmployee: {
          employeeCode: "$occurrenceAssignedEmployee.employeeCode",
          firstName: "$occurrenceAssignedUser.firstName",
          lastName: "$occurrenceAssignedUser.lastName",
        },
        cleaningRecord: 1,
        actualCleanerEmployee: {
          employeeCode: "$actualCleanerEmployee.employeeCode",
          firstName: "$actualCleanerEmployeeUser.firstName",
          lastName: "$actualCleanerEmployeeUser.lastName",
        },
        reportingEmployee: {
          employeeCode: "$reportingEmployee.employeeCode",
          firstName: "$reportingEmployeeUser.firstName",
          lastName: "$reportingEmployeeUser.lastName",
        },
      },
    },
  );

  return pipeline;
};

export const buildCurrentMonitoringRows = ({ records, plans, filters }) => {
  const activePlans = plans.filter(
    (plan) =>
      plan.isActive === true && CLEANING_TYPES.includes(plan.maintenanceType),
  );
  const plansById = new Map(
    activePlans.map((plan) => [idString(plan._id), plan]),
  );
  return records
    .filter((record) => plansById.has(record.planId))
    .filter((record) =>
      !filters.monitoringStatus || record.status === filters.monitoringStatus,
    )
    .filter((record) =>
      !filters.maintenanceType ||
      record.maintenanceType === filters.maintenanceType,
    )
    .filter((record) =>
      !filters.employeeId ||
      idString(record.responsibleEmployee?._id) === filters.employeeId,
    )
    .map((record) => ({
      ...record,
      atm: plansById.get(record.planId)?.atmId ?? null,
    }))
    .filter((record) => matchesCurrentMonitoringFilters(record, filters));
};

const getMonitoringRows = async ({ records, filters, deadline }) => {
  if (records.length === 0) return [];
  assertCleaningExportActive({ deadline });
  const planIds = records.map((record) => asObjectId(record.planId));
  let planQuery = RecurringMaintenancePlan.find({
    _id: { $in: planIds },
    isActive: true,
    maintenanceType: { $in: CLEANING_TYPES },
  })
    .select("_id atmId isActive maintenanceType")
    .populate({
      path: "atmId",
      select:
        "atmId clientAtmId locationName address bankId regionId districtId",
      populate: [
        { path: "bankId", select: "bankName" },
        { path: "regionId", select: "name" },
        { path: "districtId", select: "districtName" },
      ],
    });
  planQuery = planQuery.maxTimeMS(getQueryTimeLimit(deadline));
  const plans = await planQuery.lean();
  assertCleaningExportActive({ deadline });
  return buildCurrentMonitoringRows({ records, plans, filters });
};

const matchesCurrentMonitoringFilters = (record, filters) => {
  const atm = record.atm;
  const matchesId = (filterId, value) =>
    !filterId || idString(value?._id ?? value) === filterId;
  return (
    matchesId(filters.bankId, atm?.bankId) &&
    matchesId(filters.regionId, atm?.regionId) &&
    matchesId(filters.districtId, atm?.districtId)
  );
};

const createScheduledJobsIterator = ({
  pipeline,
  signal,
  deadline,
}) => {
  const maxTimeMS = getQueryTimeLimit(deadline);
  const cursor = Job.aggregate(pipeline)
    .option({ maxTimeMS, allowDiskUse: true })
    .cursor({ batchSize: CURSOR_BATCH_SIZE });
  const closeOnAbort = () => {
    void cursor.close().catch((error) => {
      console.error("[Cleaning Export] Failed to close cancelled job cursor:", error);
    });
  };
  signal?.addEventListener("abort", closeOnAbort, { once: true });

  return (async function* iterate() {
    let rows = 0;
    try {
      for await (const job of cursor) {
        assertCleaningExportActive({ signal, deadline });
        rows += 1;
        if (rows > EXPORT_MAX_ROWS) {
          throw new ApiError(
            413,
            "Scheduled Jobs exceed the Excel worksheet row limit",
          );
        }
        yield job;
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new ApiError(504, "Cleaning export exceeded its time limit");
      }
      if ([50, 262].includes(error?.code)) {
        throw new ApiError(
          504,
          "Cleaning export database query exceeded its time limit",
        );
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", closeOnAbort);
      await cursor.close();
    }
  })();
};

export const generateRecurringCleaningExport = async ({
  filters,
  signal,
  generatedAt = new Date(),
}) => {
  const deadline = Date.now() + EXPORT_TIMEOUT_MS;
  const directory = await mkdtemp(
    join(tmpdir(), `atm-cleaning-export-${process.pid}-`),
  );
  const filePath = join(directory, "recurring-cleaning-export.xlsx");
  try {
    assertCleaningExportActive({ signal, deadline });
    const monitoringRecords = await getCleaningMonitoringRecords(generatedAt, {
      signal,
      deadline,
    });
    assertCleaningExportActive({ signal, deadline });

    const monitoredPlanIds = filters.monitoringStatus
      ? getMonitoringPlanIdsForStatus(
          monitoringRecords,
          filters.monitoringStatus,
        )
      : [];
    const employeeUserId = await resolveEmployeeUserId(
      filters.employeeId,
      deadline,
    );
    const scheduledJobsPipeline = buildScheduledJobsPipeline({
      filters,
      employeeUserId,
      monitoringPlanIds: monitoredPlanIds,
    });
    const monitoringRows = await getMonitoringRows({
      records: monitoringRecords,
      filters,
      deadline,
    });
    const scheduledJobs = createScheduledJobsIterator({
      pipeline: scheduledJobsPipeline,
      signal,
      deadline,
    });

    await writeRecurringCleaningWorkbook({
      scheduledJobs,
      monitoringRows,
      outputPath: filePath,
      signal,
      deadline,
      generatedAt,
      maxBytes: EXPORT_MAX_BYTES,
      maxRows: EXPORT_MAX_ROWS,
    });

    return {
      directory,
      filePath,
      filename: `recurring-cleaning-${filters.fromDate}-to-${filters.toDate}.xlsx`,
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};

export const cleaningExportLimits = {
  maxDays: MAX_CLEANING_EXPORT_DAYS,
  maxDurationMs: EXPORT_TIMEOUT_MS,
  maxBytes: EXPORT_MAX_BYTES,
  maxRows: EXPORT_MAX_ROWS,
  queryTimeoutMs: EXPORT_QUERY_TIMEOUT_MS,
};
