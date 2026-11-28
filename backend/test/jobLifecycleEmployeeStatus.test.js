import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { authorizeRoles } from "../src/middlewares/role.middleware.js";
import ATM from "../src/modules/atms/atm.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import JobHistory from "../src/modules/jobs/jobHistory.model.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";
import Notification from "../src/modules/notification/notification.model.js";
import User from "../src/modules/users/user.model.js";
import CleaningRecord from "../src/modules/cleaningRecords/cleaningRecord.model.js";
import {
  acceptJob,
  completeJob,
  holdJob,
  reassignJob,
  startJob,
} from "../src/modules/jobs/jobs.controller.js";
import {
  completeJobSchema,
  getGpsCaptureTimestampError,
} from "../src/modules/jobs/jobs.validation.js";

const jobId = "64b000000000000000000091";
const atmId = "64b000000000000000000092";
const employeeId = "64b000000000000000000093";
const employeeUserId = "64b000000000000000000094";
const nextEmployeeId = "64b000000000000000000095";
const nextEmployeeUserId = "64b000000000000000000096";
const adminId = "64b000000000000000000097";
const superAdminId = "64b000000000000000000098";

const invoke = (handler, req) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body });
      },
    };
    handler(req, res, (error) => resolve({ error }));
  });

const makeQuery = (value) => ({
  populate() {
    return this;
  },
  session() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const snapshotJob = (job) =>
  Object.fromEntries(
    [
      "status",
      "assignedEmployeeId",
      "acceptedAt",
      "startedAt",
      "completedAt",
      "employeeGpsAtCompletion",
      "gpsDistance",
      "gpsValidated",
      "employeeRemarks",
      "beforePhotos",
      "afterPhotos",
      "updatedBy",
    ].map((key) => [
      key,
      Array.isArray(job[key])
        ? [...job[key]]
        : job[key] && typeof job[key] === "object"
          ? { ...job[key] }
          : job[key],
    ]),
  );

const makeJob = (status, recurringMaintenance) => ({
  _id: jobId,
  atmId,
  ...(recurringMaintenance ? { recurringMaintenance } : {}),
  assignedEmployeeId: employeeUserId,
  assignedBy: adminId,
  status,
  isDeleted: false,
  acceptedAt: new Date("2026-10-01T09:00:00.000Z"),
  startedAt: new Date("2026-10-01T09:30:00.000Z"),
  completedAt: new Date("2026-10-01T10:00:00.000Z"),
  employeeGpsAtCompletion: {
    latitude: 12.5,
    longitude: 77.5,
    accuracy: 3,
    timestamp: new Date("2026-10-01T10:00:00.000Z"),
  },
  gpsDistance: 4,
  gpsValidated: true,
  employeeRemarks: "Existing remarks",
  beforePhotos: ["before-1", "before-2", "before-3"],
  afterPhotos: ["after-1", "after-2", "after-3"],
  reassignmentHistory: [],
  saveCalls: 0,
  async save(options) {
    this.saveCalls += 1;
    this.lastSaveOptions = options;
    return this;
  },
});

const makeEmployee = (status, linkedUserStatus = "active", userId = employeeUserId) => ({
  _id: userId === employeeUserId ? employeeId : nextEmployeeId,
  status,
  userId: {
    _id: userId,
    status: linkedUserStatus,
    userType: "employee",
  },
});

const employeeRequest = (status) => ({
  params: { id: jobId },
  body:
    status === "IN_PROGRESS"
      ? {
          gps: {
            latitude: 0,
            longitude: 0,
            accuracy: 5,
            capturedAtMs: Date.now(),
          },
        }
      : {},
  user: { _id: employeeUserId, userType: "employee" },
  headers: {},
});

async function withLifecycleMocks(
  {
    status,
    employeeStatus = "active",
    userStatus = "active",
    recurringMaintenance,
    existingCleaningRecord = null,
    cleaningRecordCreateError,
  },
  callback,
) {
  const job = makeJob(status, recurringMaintenance);
  const atm = {
    _id: atmId,
    locationConfigured: true,
    location: { coordinates: [0, 0] },
    assignedEmployeeId: [employeeId],
  };
  const historyEntries = [];
  const employeeLookups = [];
  const notifications = [];
  const notificationTransactionStates = [];
  const realtimeLookupsInTransaction = [];
  const createdCleaningRecords = [];
  const transactionWrites = [];
  const employee = makeEmployee(employeeStatus, userStatus);
  const session = {
    async withTransaction(operation) {
      const jobBefore = snapshotJob(job);
      const historyLength = historyEntries.length;
      const recordLength = createdCleaningRecords.length;
      const writeLength = transactionWrites.length;
      const existingRecordBefore = existingCleaningRecord
        ? {
            ...existingCleaningRecord,
            evidencePhotoIds: [
              ...(existingCleaningRecord.evidencePhotoIds || []),
            ],
            submissionHistory: [
              ...(existingCleaningRecord.submissionHistory || []),
            ],
            correctionHistory: [
              ...(existingCleaningRecord.correctionHistory || []),
            ],
          }
        : null;
      this.inTransaction = true;
      try {
        await operation();
      } catch (error) {
        Object.assign(job, jobBefore);
        historyEntries.length = historyLength;
        createdCleaningRecords.length = recordLength;
        transactionWrites.length = writeLength;
        if (existingRecordBefore) {
          Object.assign(existingCleaningRecord, existingRecordBefore);
        }
        throw error;
      } finally {
        this.inTransaction = false;
      }
    },
    async endSession() {},
  };
  const originals = [
    [mongoose, "startSession", mongoose.startSession],
    [Job, "findById", Job.findById],
    [JobHistory, "create", JobHistory.create],
    [JobPhoto, "countDocuments", JobPhoto.countDocuments],
    [ATM, "findById", ATM.findById],
    [Employee, "find", Employee.find],
    [Employee, "findOne", Employee.findOne],
    [User, "find", User.find],
    [Notification, "create", Notification.create],
    [CleaningRecord, "findOne", CleaningRecord.findOne],
    [CleaningRecord, "create", CleaningRecord.create],
  ];

  mongoose.startSession = async () => session;
  Job.findById = () => makeQuery(job);
  JobHistory.create = async (entries, options) => {
    const records = Array.isArray(entries) ? entries : [entries];
    historyEntries.push(...records);
    if (options?.session) {
      transactionWrites.push({
        collection: "jobHistory",
        session: options.session,
      });
    }
    return records;
  };
  JobPhoto.countDocuments = (filter) => ({
    session() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(
        filter.photoType === "before" ? 3 : 3,
      ).then(resolve, reject);
    },
  });
  ATM.findById = () => makeQuery(atm);
  Employee.find = (filter) => {
    if (session.inTransaction) realtimeLookupsInTransaction.push(filter);
    return {
      select() {
        return this;
      },
      lean: async () => {
        const employees = [
          employee,
          makeEmployee("active", "active", nextEmployeeUserId),
        ];
        return employees.filter((candidate) =>
          (filter.$or ?? []).some((condition) => {
            const [field, matcher] = Object.entries(condition)[0];
            return matcher.$in.some((id) =>
              field === "_id"
                ? String(id) === String(candidate._id)
                : String(id) ===
                  String(candidate.userId?._id ?? candidate.userId),
            );
          }),
        );
      },
    };
  };
  Employee.findOne = (filter) => {
    employeeLookups.push(filter);
    const found =
      filter.userId === employeeUserId &&
      (!filter.status || filter.status === employeeStatus)
        ? employee
        : null;
    return {
      populate: async () => found,
      select() {
        return this;
      },
      lean: async () =>
        found && found.status === "active" && userStatus === "active"
          ? { userId: employeeUserId }
          : null,
    };
  };
  User.find = (filter) => ({
    select() {
      return this;
    },
    lean: async () =>
      [
        { _id: adminId, userType: "admin", status: "active" },
        { _id: superAdminId, userType: "superAdmin", status: "active" },
        { _id: employeeUserId, userType: "employee", status: userStatus },
        { _id: nextEmployeeUserId, userType: "employee", status: "active" },
      ].filter(
        (user) =>
          user.status === filter.status &&
          (!filter.userType || filter.userType.$in.includes(user.userType)) &&
          (!filter._id ||
            filter._id.$in.some((id) => String(id) === String(user._id))),
      ),
  });
  Notification.create = async (input) => {
    notificationTransactionStates.push(session.inTransaction);
    notifications.push(input);
    return { ...input, _id: String(notifications.length) };
  };
  CleaningRecord.findOne = () => ({
    session() {
      return Promise.resolve(existingCleaningRecord);
    },
  });
  CleaningRecord.create = async (records, options) => {
    if (cleaningRecordCreateError) throw cleaningRecordCreateError;
    createdCleaningRecords.push(...records);
    transactionWrites.push({
      collection: "cleaningRecords",
      session: options.session,
    });
    return records.map((record) => ({ ...record, _id: jobId }));
  };

  try {
    await callback({
      job,
      historyEntries,
      employeeLookups,
      notifications,
      notificationTransactionStates,
      realtimeLookupsInTransaction,
      createdCleaningRecords,
      transactionWrites,
      session,
    });
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
}

test("active Employee with active User can accept an assigned Job", async () => {
  await withLifecycleMocks(
    { status: "ASSIGNED" },
    async ({ job, historyEntries, employeeLookups, notifications }) => {
      const result = await invoke(acceptJob, employeeRequest("ASSIGNED"));

      assert.equal(result.error, undefined);
      assert.equal(result.statusCode, 200);
      assert.equal(job.status, "ACCEPTED");
      assert.equal(job.assignedEmployeeId, employeeUserId);
      assert.ok(job.acceptedAt instanceof Date);
      assert.equal(historyEntries.length, 1);
      assert.equal(notifications.length, 0);
    },
  );
});

test("employee start and resume update realtime state without Admin notifications", async () => {
  for (const status of ["ACCEPTED", "ON_HOLD"]) {
    await withLifecycleMocks(
      { status },
      async ({ job, historyEntries, notifications }) => {
        const result = await invoke(startJob, employeeRequest(status));

        assert.equal(result.error, undefined);
        assert.equal(result.statusCode, 200);
        assert.equal(job.status, "IN_PROGRESS");
        assert.equal(historyEntries.length, 1);
        assert.equal(notifications.length, 0);
      },
    );
  }
});

test("employee hold updates realtime state without an Admin notification", async () => {
  await withLifecycleMocks(
    { status: "IN_PROGRESS" },
    async ({ job, historyEntries, notifications }) => {
      const result = await invoke(holdJob, {
        ...employeeRequest("IN_PROGRESS"),
        body: { reason: "Waiting for access" },
      });

      assert.equal(result.error, undefined);
      assert.equal(result.statusCode, 200);
      assert.equal(job.status, "ON_HOLD");
      assert.equal(historyEntries.length, 1);
      assert.equal(notifications.length, 0);
    },
  );
});

test("non-cleaning completion works without cleaner fields and preserves Admin notifications", async () => {
  await withLifecycleMocks(
    { status: "IN_PROGRESS" },
    async ({ job, historyEntries, notifications, createdCleaningRecords }) => {
      const request = employeeRequest("IN_PROGRESS");
      const result = await invoke(completeJob, request);

      assert.equal(result.error, undefined);
      assert.equal(result.statusCode, 200);
      assert.equal(job.status, "COMPLETED");
      assert.equal(
        job.employeeGpsAtCompletion.timestamp.getTime(),
        request.body.gps.capturedAtMs,
      );
      assert.equal(historyEntries.length, 1);
      assert.deepEqual(createdCleaningRecords, []);
      assert.equal(notifications.length, 2);
      assert.deepEqual(
        notifications.map(({ userId }) => String(userId)).sort(),
        [adminId, superAdminId].sort(),
      );
      assert.ok(
        notifications.every(
          ({ data, dedupeKey }) =>
            data.action === "completed" &&
            dedupeKey.startsWith(`job:${jobId}:completed:`),
        ),
      );
    },
  );
});

test("recurring cleaning completion rejects a missing cleaner type before writes", async () => {
  const planId = "64b000000000000000000099";
  const existingCleaningRecord = {
    recurringPlanId: planId,
    occurrenceKey: `${atmId}:DAILY_CLEANING:2026-11-26`,
    atmId,
    revision: 1,
    validityStatus: "VOID",
    submissionHistory: [{ submittedBy: employeeUserId }],
    correctionHistory: [{ reason: "Previous correction" }],
    async save() {},
  };
  await withLifecycleMocks(
    {
      status: "IN_PROGRESS",
      recurringMaintenance: {
        source: "RECURRING",
        planId,
        maintenanceType: "DAILY_CLEANING",
        occurrenceKey: `${atmId}:DAILY_CLEANING:2026-11-26`,
      },
      existingCleaningRecord,
    },
    async ({ job, historyEntries, createdCleaningRecords }) => {
      const result = await invoke(
        completeJob,
        employeeRequest("IN_PROGRESS"),
      );

      assert.equal(result.error?.statusCode, 400);
      assert.equal(job.status, "IN_PROGRESS");
      assert.equal(job.saveCalls, 0);
      assert.deepEqual(historyEntries, []);
      assert.deepEqual(createdCleaningRecords, []);
      assert.equal(existingCleaningRecord.validityStatus, "VOID");
      assert.equal(existingCleaningRecord.submissionHistory.length, 1);
      assert.equal(existingCleaningRecord.correctionHistory.length, 1);
    },
  );
});

test("employee recurring cleaning completion records the occurrence in the job transaction", async () => {
  const planId = "64b000000000000000000099";
  const occurrenceKey = `${atmId}:DAILY_CLEANING:2026-11-26`;
  await withLifecycleMocks(
    {
      status: "IN_PROGRESS",
      recurringMaintenance: {
        source: "RECURRING",
        planId,
        maintenanceType: "DAILY_CLEANING",
        occurrenceKey,
      },
    },
    async ({
      job,
      historyEntries,
      createdCleaningRecords,
      transactionWrites,
      notificationTransactionStates,
      realtimeLookupsInTransaction,
      session,
    }) => {
      const request = employeeRequest("IN_PROGRESS");
      request.body = {
        ...request.body,
        actualCleanerType: "OUTSOURCED",
        outsourcedCleanerName: "Night Cleaning Services",
      };
      const result = await invoke(completeJob, request);

      assert.equal(result.error, undefined);
      assert.equal(result.statusCode, 200);
      assert.equal(job.status, "COMPLETED");
      assert.equal(job.lastSaveOptions.session, session);
      assert.equal(
        job.employeeGpsAtCompletion.timestamp.getTime(),
        request.body.gps.capturedAtMs,
      );
      assert.equal(historyEntries.length, 1);
      assert.equal(createdCleaningRecords.length, 1);

      const [record] = createdCleaningRecords;
      assert.equal(record.recurringJobId, job._id);
      assert.equal(record.recurringPlanId, planId);
      assert.equal(record.occurrenceKey, occurrenceKey);
      assert.equal(record.atmId, atmId);
      assert.equal(record.responsibleEmployeeId, employeeId);
      assert.equal(record.actualCleanerType, "OUTSOURCED");
      assert.equal(record.actualCleanerEmployeeId, null);
      assert.equal(record.outsourcedCleanerName, "Night Cleaning Services");
      assert.equal(record.submittedBy, employeeUserId);
      assert.equal(record.reportingMethod, "EMPLOYEE");
      assert.match(record.cleaningDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.deepEqual(record.evidencePhotoIds, [
        ...job.beforePhotos,
        ...job.afterPhotos,
      ]);
      assert.equal(record.submissionHistory.length, 1);
      assert.equal(transactionWrites.length, 2);
      assert.ok(transactionWrites.every((write) => write.session === session));
      assert.equal(notificationTransactionStates.length, 2);
      assert.ok(notificationTransactionStates.every((state) => state === false));
      assert.deepEqual(realtimeLookupsInTransaction, []);
    },
  );
});

test("CleaningRecord write failure aborts recurring Job completion", async () => {
  const planId = "64b000000000000000000099";
  const writeError = new Error("CleaningRecord write failed");
  await withLifecycleMocks(
    {
      status: "IN_PROGRESS",
      recurringMaintenance: {
        source: "RECURRING",
        planId,
        maintenanceType: "WEEKLY_MOPPING",
        occurrenceKey: `${atmId}:WEEKLY_MOPPING:2026-11-26`,
      },
      cleaningRecordCreateError: writeError,
    },
    async ({
      job,
      historyEntries,
      createdCleaningRecords,
      transactionWrites,
      notifications,
    }) => {
      const request = employeeRequest("IN_PROGRESS");
      request.body.actualCleanerType = "INTERNAL";
      const result = await invoke(completeJob, request);

      assert.equal(result.error, writeError);
      assert.equal(job.status, "IN_PROGRESS");
      assert.deepEqual(historyEntries, []);
      assert.deepEqual(createdCleaningRecords, []);
      assert.deepEqual(transactionWrites, []);
      assert.deepEqual(notifications, []);
    },
  );
});

test("failed rework persistence keeps an existing VOID record unchanged", async () => {
  const planId = "64b000000000000000000099";
  const occurrenceKey = `${atmId}:DAILY_CLEANING:2026-11-26`;
  const writeError = new Error("CleaningRecord update failed");
  const previousSubmission = { cleaningDate: "2026-11-25" };
  const previousCorrection = { reason: "Preserve correction audit" };
  const existingCleaningRecord = {
    recurringPlanId: planId,
    occurrenceKey,
    atmId,
    revision: 3,
    validityStatus: "VOID",
    submissionHistory: [previousSubmission],
    correctionHistory: [previousCorrection],
    async save() {
      throw writeError;
    },
  };
  await withLifecycleMocks(
    {
      status: "IN_PROGRESS",
      recurringMaintenance: {
        source: "RECURRING",
        planId,
        maintenanceType: "DAILY_CLEANING",
        occurrenceKey,
      },
      existingCleaningRecord,
    },
    async ({ job, historyEntries, notifications }) => {
      const request = employeeRequest("IN_PROGRESS");
      request.body.actualCleanerType = "INTERNAL";
      const result = await invoke(completeJob, request);

      assert.equal(result.error, writeError);
      assert.equal(job.status, "IN_PROGRESS");
      assert.deepEqual(historyEntries, []);
      assert.deepEqual(notifications, []);
      assert.equal(existingCleaningRecord.revision, 3);
      assert.equal(existingCleaningRecord.validityStatus, "VOID");
      assert.deepEqual(existingCleaningRecord.submissionHistory, [
        previousSubmission,
      ]);
      assert.deepEqual(existingCleaningRecord.correctionHistory, [
        previousCorrection,
      ]);
    },
  );
});

test("unsupported recurring maintenance types do not create CleaningRecords", async () => {
  await withLifecycleMocks(
    {
      status: "IN_PROGRESS",
      recurringMaintenance: {
        source: "RECURRING",
        planId: "64b000000000000000000099",
        maintenanceType: "OTHER",
        occurrenceKey: `${atmId}:OTHER:2026-11-26`,
      },
    },
    async ({ job, createdCleaningRecords }) => {
      const result = await invoke(
        completeJob,
        employeeRequest("IN_PROGRESS"),
      );

      assert.equal(result.error, undefined);
      assert.equal(job.status, "COMPLETED");
      assert.deepEqual(createdCleaningRecords, []);
    },
  );
});

test("reworked cleaning completion updates its existing occurrence record", async () => {
  const planId = "64b000000000000000000099";
  const occurrenceKey = `${atmId}:DAILY_CLEANING:2026-11-26`;
  const previousSubmission = {
    submittedBy: employeeUserId,
    cleaningDate: "2026-11-25",
    evidencePhotoIds: ["previous-photo"],
  };
  const previousCorrection = {
    correctedBy: adminId,
    reason: "Corrected the cleaner name",
    changes: [{ field: "outsourcedCleanerName" }],
  };
  const existingCleaningRecord = {
    recurringPlanId: planId,
    occurrenceKey,
    atmId,
    revision: 2,
    validityStatus: "VOID",
    submissionHistory: [previousSubmission],
    correctionHistory: [previousCorrection],
    async save(options) {
      this.lastSaveOptions = options;
    },
  };
  await withLifecycleMocks(
    {
      status: "IN_PROGRESS",
      recurringMaintenance: {
        source: "RECURRING",
        planId,
        maintenanceType: "DAILY_CLEANING",
        occurrenceKey,
      },
      existingCleaningRecord,
    },
    async ({ job, createdCleaningRecords, session }) => {
      const request = employeeRequest("IN_PROGRESS");
      request.body.actualCleanerType = "INTERNAL";
      const result = await invoke(completeJob, request);

      assert.equal(result.error, undefined);
      assert.equal(job.status, "COMPLETED");
      assert.deepEqual(createdCleaningRecords, []);
      assert.equal(existingCleaningRecord.revision, 3);
      assert.equal(existingCleaningRecord.validityStatus, "VALID");
      assert.equal(existingCleaningRecord.responsibleEmployeeId, employeeId);
      assert.equal(existingCleaningRecord.actualCleanerType, "INTERNAL");
      assert.equal(existingCleaningRecord.actualCleanerEmployeeId, employeeId);
      assert.equal(existingCleaningRecord.submissionHistory.length, 2);
      assert.deepEqual(
        existingCleaningRecord.submissionHistory[0],
        previousSubmission,
      );
      assert.deepEqual(existingCleaningRecord.correctionHistory, [
        previousCorrection,
      ]);
      assert.equal(existingCleaningRecord.lastSaveOptions.session, session);
    },
  );
});

test("completion cleaner fields require a name only for outsourced cleaners", () => {
  const completion = {
    gps: {
      latitude: 0,
      longitude: 0,
      accuracy: 5,
      capturedAtMs: Date.now(),
    },
  };
  assert.equal(completeJobSchema.safeParse(completion).success, true);
  assert.equal(
    completeJobSchema.safeParse({
      ...completion,
      actualCleanerType: "OUTSOURCED",
      outsourcedCleanerName: "Cleaning Services",
    }).success,
    true,
  );
  assert.equal(
    completeJobSchema.safeParse({
      ...completion,
      actualCleanerType: "OUTSOURCED",
    }).success,
    false,
  );
  assert.equal(
    completeJobSchema.safeParse({
      ...completion,
      actualCleanerType: "INTERNAL",
      outsourcedCleanerName: "Cleaning Services",
    }).success,
    false,
  );
});

test("GPS capture timestamps enforce age and future-skew limits", () => {
  const now = 1_800_000_000_000;
  assert.equal(getGpsCaptureTimestampError(now - 120_000, now), null);
  assert.match(
    getGpsCaptureTimestampError(now - 120_001, now),
    /older than 2 minutes/,
  );
  assert.equal(getGpsCaptureTimestampError(now + 30_000, now), null);
  assert.match(
    getGpsCaptureTimestampError(now + 30_001, now),
    /too far in the future/,
  );
  assert.match(getGpsCaptureTimestampError(undefined, now), /timestamp is invalid/);
  assert.match(getGpsCaptureTimestampError("1800000000000", now), /timestamp is invalid/);

  for (const capturedAtMs of [-1, 1.5]) {
    assert.match(
      getGpsCaptureTimestampError(capturedAtMs, now),
      /timestamp is invalid/,
    );
    assert.equal(
      completeJobSchema.safeParse({
        gps: { latitude: 0, longitude: 0, capturedAtMs },
      }).success,
      false,
    );
  }

  assert.equal(
    completeJobSchema.safeParse({
      gps: {
        latitude: 0,
        longitude: 0,
        capturedAtMs: Date.now(),
      },
    }).success,
    true,
  );
  assert.equal(
    completeJobSchema.safeParse({
      gps: { latitude: 0, longitude: 0 },
    }).success,
    false,
  );
  assert.equal(
    completeJobSchema.safeParse({
      gps: {
        latitude: 0,
        longitude: 0,
        capturedAtMs: Date.now() - 120_001,
      },
    }).success,
    false,
  );
  assert.equal(
    completeJobSchema.safeParse({
      gps: {
        latitude: 0,
        longitude: 0,
        capturedAtMs: Date.now() + 31_000,
      },
    }).success,
    false,
  );
});

test("stale GPS prevents recurring cleaning completion before transaction writes", async () => {
  const planId = "64b000000000000000000099";
  const occurrenceKey = `${atmId}:DAILY_CLEANING:2026-11-26`;
  const existingCleaningRecord = {
    recurringPlanId: planId,
    occurrenceKey,
    atmId,
    validityStatus: "VALID",
    revision: 1,
    submissionHistory: [],
    correctionHistory: [],
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
    },
  };

  await withLifecycleMocks(
    {
      status: "IN_PROGRESS",
      recurringMaintenance: {
        source: "RECURRING",
        planId,
        maintenanceType: "DAILY_CLEANING",
        occurrenceKey,
      },
      existingCleaningRecord,
    },
    async ({
      job,
      historyEntries,
      createdCleaningRecords,
      transactionWrites,
    }) => {
      const request = employeeRequest("IN_PROGRESS");
      request.body.actualCleanerType = "INTERNAL";
      request.body.gps.capturedAtMs = Date.now() - 120_001;

      const result = await invoke(completeJob, request);

      assert.equal(result.error?.statusCode, 400);
      assert.match(result.error.message, /older than 2 minutes/);
      assert.equal(job.status, "IN_PROGRESS");
      assert.equal(job.saveCalls, 0);
      assert.deepEqual(historyEntries, []);
      assert.deepEqual(createdCleaningRecords, []);
      assert.equal(existingCleaningRecord.saveCalls, 0);
      assert.deepEqual(transactionWrites, []);
    },
  );
});

test("stale GPS prevents non-cleaning Job completion", async () => {
  await withLifecycleMocks(
    { status: "IN_PROGRESS" },
    async ({ job, historyEntries }) => {
      const request = employeeRequest("IN_PROGRESS");
      request.body.gps.capturedAtMs = Date.now() - 120_001;
      const result = await invoke(completeJob, request);

      assert.equal(result.error?.statusCode, 400);
      assert.match(result.error.message, /older than 2 minutes/);
      assert.equal(job.status, "IN_PROGRESS");
      assert.equal(job.saveCalls, 0);
      assert.deepEqual(historyEntries, []);
    },
  );
});

for (const employeeStatus of ["inactive", "on_leave", "resigned"]) {
  test(`non-active ${employeeStatus} Employee cannot accept an assigned Job with active User`, async () => {
    await withLifecycleMocks(
      { status: "ASSIGNED", employeeStatus, userStatus: "active" },
      async ({ job, historyEntries }) => {
        const before = snapshotJob(job);
        const result = await invoke(acceptJob, employeeRequest("ASSIGNED"));

        assert.equal(result.error?.statusCode, 400);
        assert.deepEqual(snapshotJob(job), before);
        assert.equal(job.saveCalls, 0);
        assert.deepEqual(historyEntries, []);
      },
    );
  });

  test(`non-active ${employeeStatus} Employee cannot start an accepted Job`, async () => {
    await withLifecycleMocks(
      { status: "ACCEPTED", employeeStatus, userStatus: "active" },
      async ({ job, historyEntries }) => {
        const before = snapshotJob(job);
        const result = await invoke(startJob, employeeRequest("ACCEPTED"));

        assert.equal(result.error?.statusCode, 400);
        assert.deepEqual(snapshotJob(job), before);
        assert.equal(job.saveCalls, 0);
        assert.deepEqual(historyEntries, []);
      },
    );
  });

  test(`non-active ${employeeStatus} Employee cannot resume an on-hold Job`, async () => {
    await withLifecycleMocks(
      { status: "ON_HOLD", employeeStatus, userStatus: "active" },
      async ({ job, historyEntries }) => {
        const before = snapshotJob(job);
        const result = await invoke(startJob, employeeRequest("ON_HOLD"));

        assert.equal(result.error?.statusCode, 400);
        assert.deepEqual(snapshotJob(job), before);
        assert.equal(job.saveCalls, 0);
        assert.deepEqual(historyEntries, []);
      },
    );
  });

  test(`non-active ${employeeStatus} Employee cannot complete an in-progress Job`, async () => {
    await withLifecycleMocks(
      { status: "IN_PROGRESS", employeeStatus, userStatus: "active" },
      async ({ job, historyEntries }) => {
        const before = snapshotJob(job);
        const result = await invoke(completeJob, employeeRequest("IN_PROGRESS"));

        assert.equal(result.error?.statusCode, 400);
        assert.deepEqual(snapshotJob(job), before);
        assert.equal(job.saveCalls, 0);
        assert.deepEqual(historyEntries, []);
      },
    );
  });
}

test("existing ownership and lifecycle status restrictions still reject actions", async (t) => {
  const cases = [
    {
      name: "another User cannot accept the assignment",
      status: "ASSIGNED",
      handler: acceptJob,
      request: {
        ...employeeRequest("ASSIGNED"),
        user: { _id: nextEmployeeUserId, userType: "employee" },
      },
      expectedStatus: 403,
    },
    {
      name: "Employee cannot accept outside ASSIGNED",
      status: "ON_HOLD",
      handler: acceptJob,
      request: employeeRequest("ON_HOLD"),
      expectedStatus: 400,
    },
    {
      name: "Employee cannot start outside ACCEPTED or ON_HOLD",
      status: "ASSIGNED",
      handler: startJob,
      request: employeeRequest("ASSIGNED"),
      expectedStatus: 400,
    },
    {
      name: "Employee cannot complete outside IN_PROGRESS",
      status: "ACCEPTED",
      handler: completeJob,
      request: employeeRequest("IN_PROGRESS"),
      expectedStatus: 400,
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      await withLifecycleMocks(
        { status: entry.status },
        async ({ job, historyEntries }) => {
          const before = snapshotJob(job);
          const result = await invoke(entry.handler, entry.request);

          assert.equal(result.error?.statusCode, entry.expectedStatus);
          assert.deepEqual(snapshotJob(job), before);
          assert.equal(job.saveCalls, 0);
          assert.deepEqual(historyEntries, []);
        },
      );
    });
  }
});

test("Employee lifecycle routes remain employee-only; Admin actions remain Admin/SuperAdmin-only", () => {
  for (const action of ["accept", "start", "complete"]) {
    assert.doesNotThrow(() =>
      authorizeRoles("employee")(
        { user: { userType: "employee" } },
        {},
        () => {},
      ),
      `${action} should authorize Employees`,
    );
    for (const userType of ["admin", "superAdmin"]) {
      assert.throws(
        () =>
          authorizeRoles("employee")(
            { user: { userType } },
            {},
            () => {},
          ),
        { statusCode: 403 },
      );
    }
  }

  for (const userType of ["admin", "superAdmin"]) {
    assert.doesNotThrow(() =>
      authorizeRoles("admin", "superAdmin")(
        { user: { userType } },
        {},
        () => {},
      ),
    );
  }
  assert.throws(
    () =>
      authorizeRoles("admin", "superAdmin")(
        { user: { userType: "employee" } },
        {},
        () => {},
      ),
    { statusCode: 403 },
  );
});

test("Admin can reassign a Job away from a non-active incumbent to an active Employee", async (t) => {
  for (const userType of ["admin", "superAdmin"]) {
    await t.test(userType, async () => {
      const job = makeJob("ASSIGNED");
      job.status = "ACCEPTED";
      const atm = {
        _id: atmId,
        isDeleted: false,
        assignedEmployeeId: [employeeId, nextEmployeeId],
      };
      const historyEntries = [];
      const notifications = [];
      const originals = [
        [Job, "findById", Job.findById],
        [JobHistory, "create", JobHistory.create],
        [ATM, "findById", ATM.findById],
        [Employee, "find", Employee.find],
        [Employee, "findOne", Employee.findOne],
        [User, "find", User.find],
        [Notification, "create", Notification.create],
      ];
      Job.findById = () => makeQuery(job);
      JobHistory.create = async (entry) => {
        historyEntries.push(entry);
        return entry;
      };
      ATM.findById = async () => atm;
      Employee.find = () => ({
        select() {
          return this;
        },
        lean: async () => [],
      });
      Employee.findOne = (filter) => {
        const found =
          filter.userId === nextEmployeeUserId
            ? makeEmployee("active", "active", nextEmployeeUserId)
            : null;
        return {
          populate: async () => found,
          select() {
            return this;
          },
          lean: async () =>
            found ? { userId: nextEmployeeUserId } : null,
        };
      };
      User.find = (filter) => ({
        select() {
          return this;
        },
        lean: async () =>
          [
            { _id: adminId, userType: "admin", status: "active" },
            { _id: nextEmployeeUserId, userType: "employee", status: "active" },
          ].filter(
            (user) =>
              user.status === filter.status &&
              (!filter.userType ||
                filter.userType.$in.includes(user.userType)) &&
              (!filter._id ||
                filter._id.$in.some((id) => String(id) === String(user._id))),
          ),
      });
      Notification.create = async (input) => {
        notifications.push(input);
        return { ...input, _id: String(notifications.length) };
      };

      try {
        const result = await invoke(reassignJob, {
          params: { id: jobId },
          body: {
            employeeId: nextEmployeeUserId,
            reason: "Reassign from non-active employee",
          },
          user: { _id: adminId, userType },
          headers: {},
        });

        assert.equal(result.error, undefined);
        assert.equal(result.statusCode, 200);
        assert.equal(job.status, "ASSIGNED");
        assert.equal(job.assignedEmployeeId, nextEmployeeUserId);
        assert.equal(job.reassignmentHistory[0].fromEmployee, employeeUserId);
        assert.equal(job.reassignmentHistory[0].toEmployee, nextEmployeeUserId);
        assert.equal(historyEntries.length, 1);
        assert.equal(historyEntries[0].action, "reassigned");
        assert.equal(notifications.length, 1);
        assert.equal(String(notifications[0].userId), nextEmployeeUserId);
      } finally {
        for (const [target, key, original] of originals.reverse()) {
          target[key] = original;
        }
      }
    });
  }
});
