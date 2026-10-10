import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Attendance from "../src/modules/attendance/attendance.model.js";
import AttendanceCorrection from "../src/modules/attendance/attendanceCorrection.model.js";
import AttendanceEntryAudit from "../src/modules/attendance/attendanceEntryAudit.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import {
  checkInForEmployee,
  checkOutAttendanceForEmployee,
  checkOutForEmployee,
  correctAttendance,
  getAttendanceRecord,
  listAttendanceRecords,
  listMyAttendance,
  recordAttendanceForEmployee,
  resolveEmployeeForAuthenticatedUser,
} from "../src/modules/attendance/attendance.service.js";

const employeeId = "64b000000000000000000001";
const employeeUserId = "64b000000000000000000002";
const supervisorId = "64b000000000000000000003";
const adminId = "64b000000000000000000004";
const attendanceId = "64b000000000000000000005";
const now = new Date("2026-10-10T06:00:00.000Z");

const makeEmployee = ({
  id = employeeId,
  userId = employeeUserId,
  employeeStatus = "active",
  userStatus = "active",
  userType = "employee",
  supervisor = supervisorId,
} = {}) => ({
  _id: id,
  userId: { _id: userId, userType, status: userStatus },
  status: employeeStatus,
  supervisorId: supervisor,
});

const makeAttendance = (overrides = {}) => ({
  _id: attendanceId,
  employeeId,
  attendanceDate: "2026-10-10",
  checkInAt: new Date("2026-10-10T03:00:00.000Z"),
  checkOutAt: null,
  checkInRecordedBy: employeeUserId,
  checkOutRecordedBy: null,
  checkInSource: "employee",
  checkOutSource: null,
  ...overrides,
});

const actor = (id, userType) => ({ _id: id, userType });

const sameId = (left, right) =>
  String(left?._id ?? left).toLowerCase() ===
  String(right?._id ?? right).toLowerCase();

async function withMocks(
  {
    employee = makeEmployee(),
    records = [],
    supervisedEmployees = [],
    correctionInsertError = null,
    entryAuditInsertError = null,
    findOneAndUpdateHook,
  } = {},
  callback,
) {
  const originals = [
    [Employee, "findOne", Employee.findOne],
    [Employee, "findById", Employee.findById],
    [Employee, "find", Employee.find],
    [Attendance, "countDocuments", Attendance.countDocuments],
    [Attendance, "find", Attendance.find],
    [Attendance, "findOne", Attendance.findOne],
    [Attendance, "create", Attendance.create],
    [Attendance, "findOneAndUpdate", Attendance.findOneAndUpdate],
    [Attendance, "findById", Attendance.findById],
    [AttendanceCorrection, "create", AttendanceCorrection.create],
    [AttendanceEntryAudit, "create", AttendanceEntryAudit.create],
    [mongoose, "startSession", mongoose.startSession],
  ];
  const state = {
    employeeQueries: [],
    employeeIdQueries: [],
    records: records.map((record) => ({ ...record })),
    corrections: [],
    entryAudits: [],
    updateFilters: [],
    attendanceListFilters: [],
    auditPayloads: [],
  };
  const findQuery = (value) => ({
    populate: async () => value,
    session: async () => value,
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  });

  Employee.findOne = (filter) => {
    state.employeeQueries.push(filter);
    return findQuery(employee);
  };
  Employee.findById = (id) => {
    state.employeeIdQueries.push(id);
    return findQuery(
      employee && sameId(employee._id, id) ? employee : null,
    );
  };
  Employee.find = (filter) => ({
    select: async () => {
      assert.deepEqual(filter, { supervisorId });
      return supervisedEmployees;
    },
  });
  Attendance.findOne = (filter) => {
    const query = {
      session() {
        return this;
      },
      then(resolve, reject) {
        return Promise.resolve(
          state.records.find(
            (record) =>
              sameId(record.employeeId, filter.employeeId) &&
              record.attendanceDate === filter.attendanceDate,
          ) ?? null,
        ).then(resolve, reject);
      },
    };
    return query;
  };
  Attendance.find = (filter) => {
    state.attendanceListFilters.push(filter);
    let skip = 0;
    let limit;
    const query = {
      sort() {
        return this;
      },
      skip(value) {
        skip = value;
        return this;
      },
      limit(value) {
        limit = value;
        return Promise.resolve(
          state.records
            .filter((record) => {
              if (filter.checkOutAt === null) {
                return (
                  sameId(record.employeeId, filter.employeeId) &&
                  record.checkOutAt == null
                );
              }
              const employeeMatches =
                filter.employeeId?.$in !== undefined
                  ? filter.employeeId.$in.some((id) =>
                      sameId(record.employeeId, id),
                    )
                  : filter.employeeId === undefined ||
                    sameId(record.employeeId, filter.employeeId);
              const dateMatches =
                filter.attendanceDate === undefined ||
                ((filter.attendanceDate.$gte === undefined ||
                  record.attendanceDate >= filter.attendanceDate.$gte) &&
                  (filter.attendanceDate.$lte === undefined ||
                    record.attendanceDate <= filter.attendanceDate.$lte));
              return employeeMatches && dateMatches;
            })
            .slice(skip, skip + limit),
        );
      },
    };
    return query;
  };
  Attendance.countDocuments = async (filter) =>
    state.records.filter((record) => {
      const employeeMatches =
        filter.employeeId?.$in !== undefined
          ? filter.employeeId.$in.some((id) => sameId(record.employeeId, id))
          : filter.employeeId === undefined ||
            sameId(record.employeeId, filter.employeeId);
      const dateMatches =
        filter.attendanceDate === undefined ||
        ((filter.attendanceDate.$gte === undefined ||
          record.attendanceDate >= filter.attendanceDate.$gte) &&
          (filter.attendanceDate.$lte === undefined ||
            record.attendanceDate <= filter.attendanceDate.$lte));
      return employeeMatches && dateMatches;
    }).length;
  Attendance.create = async (documents) => {
    const input = Array.isArray(documents) ? documents[0] : documents;
    if (
      state.records.some(
        (record) =>
          sameId(record.employeeId, input.employeeId) &&
          record.attendanceDate === input.attendanceDate,
      )
    ) {
      throw { code: 11000 };
    }
    const record = { _id: new mongoose.Types.ObjectId(), ...input };
    state.records.push(record);
    return Array.isArray(documents) ? [record] : record;
  };
  Attendance.findOneAndUpdate = async (filter, update) => {
    state.updateFilters.push(filter);
    if (findOneAndUpdateHook) {
      return findOneAndUpdateHook({ filter, update, state });
    }
    const record = state.records.find(
      (candidate) =>
        (filter._id === undefined || sameId(candidate._id, filter._id)) &&
        (filter.employeeId === undefined ||
          sameId(candidate.employeeId, filter.employeeId)) &&
        (filter.attendanceDate === undefined ||
          candidate.attendanceDate === filter.attendanceDate) &&
        (filter.checkOutAt === undefined ||
          (candidate.checkOutAt === filter.checkOutAt ||
            (candidate.checkOutAt instanceof Date &&
              filter.checkOutAt instanceof Date &&
              candidate.checkOutAt.getTime() ===
                filter.checkOutAt.getTime()))) &&
        (filter.checkInAt?.$lte === undefined ||
          candidate.checkInAt <= filter.checkInAt.$lte) &&
        (filter.checkInAt instanceof Date === false ||
          candidate.checkInAt.getTime() === filter.checkInAt.getTime()) &&
        (filter.attendanceDate === undefined ||
          candidate.attendanceDate === filter.attendanceDate),
    );
    if (!record) return null;
    Object.assign(record, update.$set);
    return record;
  };
  Attendance.findById = (id) => {
    const record = state.records.find((entry) => sameId(entry._id, id));
    const result = record
      ? {
          ...record,
          checkInAt: new Date(record.checkInAt),
          checkOutAt: record.checkOutAt
            ? new Date(record.checkOutAt)
            : null,
        }
      : null;
    return {
      session: async () => result,
      then(resolve, reject) {
        return Promise.resolve(result).then(resolve, reject);
      },
    };
  };
  AttendanceCorrection.create = async (documents) => {
    state.auditPayloads.push(documents);
    if (correctionInsertError) throw correctionInsertError;
    const correction = {
      _id: new mongoose.Types.ObjectId(),
      ...documents[0],
    };
    state.corrections.push(correction);
    return [correction];
  };
  AttendanceEntryAudit.create = async (documents) => {
    if (entryAuditInsertError) throw entryAuditInsertError;
    const audit = {
      _id: new mongoose.Types.ObjectId(),
      ...documents[0],
    };
    state.entryAudits.push(audit);
    return [audit];
  };
  mongoose.startSession = async () => ({
    withTransaction: async (operation) => {
      const recordSnapshot = state.records.map((record) => ({ ...record }));
      const correctionLength = state.corrections.length;
      const entryAuditLength = state.entryAudits.length;
      try {
        await operation({});
      } catch (error) {
        state.records = recordSnapshot;
        state.corrections.length = correctionLength;
        state.entryAudits.length = entryAuditLength;
        throw error;
      }
    },
    endSession: async () => {},
  });

  try {
    await callback(state);
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
}

test("resolves authenticated User ID to the linked Employee document", async () => {
  await withMocks({}, async (state) => {
    const employee = await resolveEmployeeForAuthenticatedUser(employeeUserId);
    assert.equal(employee._id, employeeId);
    assert.deepEqual(state.employeeQueries, [{ userId: employeeUserId }]);
  });
});

test("self attendance listing is scoped to the authenticated User's Employee", async () => {
  await withMocks(
    {
      records: [
        makeAttendance(),
        makeAttendance({
          _id: "64b000000000000000000006",
          attendanceDate: "2026-10-09",
        }),
      ],
    },
    async (state) => {
      const result = await listMyAttendance(
        actor(employeeUserId, "employee"),
        {
          fromDate: "2026-10-09",
          toDate: "2026-10-10",
          page: 1,
          limit: 1,
        },
      );
      assert.equal(state.employeeQueries[0].userId, employeeUserId);
      assert.equal(state.attendanceListFilters[0].employeeId, employeeId);
      assert.equal(result.pagination.total, 2);
      assert.equal(result.records.length, 1);
    },
  );
});

test("Supervisor attendance listing and detail are limited to direct reports", async () => {
  await withMocks(
    {
      records: [makeAttendance()],
      supervisedEmployees: [{ _id: employeeId }],
    },
    async (state) => {
      const result = await listAttendanceRecords(
        actor(supervisorId, "supervisor"),
        { page: 1, limit: 20 },
      );
      assert.deepEqual(state.attendanceListFilters[0].employeeId, {
        $in: [employeeId],
      });
      assert.equal(result.pagination.total, 1);

      const record = await getAttendanceRecord(
        attendanceId,
        actor(supervisorId, "supervisor"),
      );
      assert.equal(record._id, attendanceId);
      assert.equal(state.employeeIdQueries.at(-1), employeeId);
    },
  );

  await withMocks(
    {
      employee: makeEmployee({ supervisor: "64b000000000000000000099" }),
      records: [makeAttendance()],
    },
    async (state) => {
      await assert.rejects(
        getAttendanceRecord(attendanceId, actor(supervisorId, "supervisor")),
        (error) => error.statusCode === 403,
      );
      assert.equal(state.attendanceListFilters.length, 0);
    },
  );
});

test("self check-in requires active Employee and linked active employee User", async () => {
  for (const inactive of [
    makeEmployee({ employeeStatus: "inactive" }),
    makeEmployee({ userStatus: "inactive" }),
    makeEmployee({ userType: "supervisor" }),
  ]) {
    await withMocks({ employee: inactive }, async () => {
      await assert.rejects(
        checkInForEmployee({ _id: employeeUserId }, now),
        (error) => error.statusCode === 403,
      );
    });
  }
});

test("self check-in stores the Employee ID, authenticated User actor, and Kolkata date", async () => {
  await withMocks({}, async (state) => {
    const result = await checkInForEmployee(
      { _id: employeeUserId },
      new Date("2026-10-09T19:00:00.000Z"),
    );
    assert.equal(result.employeeId, employeeId);
    assert.equal(result.checkInRecordedBy, employeeUserId);
    assert.equal(result.attendanceDate, "2026-10-10");
    assert.equal(result.checkInSource, "employee");
    assert.equal(state.records.length, 1);
  });
});

test("existing record and concurrent duplicate check-ins return conflicts", async () => {
  const record = makeAttendance();
  await withMocks({ records: [record] }, async () => {
    await assert.rejects(
      checkInForEmployee({ _id: employeeUserId }, now),
      (error) => error.statusCode === 409,
    );
  });

  await withMocks({}, async (state) => {
    const results = await Promise.allSettled([
      checkInForEmployee({ _id: employeeUserId }, now),
      checkInForEmployee({ _id: employeeUserId }, now),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(rejected.reason.statusCode, 409);
    assert.equal(state.records.length, 1);
  });
});

test("self check-out atomically closes only today's open record", async () => {
  const record = makeAttendance();
  await withMocks({ records: [record] }, async (state) => {
    const result = await checkOutForEmployee(
      { _id: employeeUserId },
      new Date("2026-10-10T18:00:00.000Z"),
    );
    assert.equal(result.checkOutAt.toISOString(), "2026-10-10T18:00:00.000Z");
    assert.equal(result.checkOutRecordedBy, employeeUserId);
    assert.equal(result.checkOutSource, "employee");
    assert.equal(state.updateFilters[0].checkOutAt, null);
    assert.equal(state.updateFilters[0]._id, attendanceId);
    assert.equal("attendanceDate" in state.updateFilters[0], false);
  });
});

test("self check-out supports a pre-midnight check-in and preserves its business date", async () => {
  const overnightRecord = makeAttendance({
    attendanceDate: "2026-10-10",
    checkInAt: new Date("2026-10-10T18:00:00.000Z"),
  });
  await withMocks({ records: [overnightRecord] }, async (state) => {
    const result = await checkOutForEmployee(
      { _id: employeeUserId },
      new Date("2026-10-10T18:45:00.000Z"),
    );

    assert.equal(result.attendanceDate, "2026-10-10");
    assert.equal(
      result.checkOutAt.toISOString(),
      "2026-10-10T18:45:00.000Z",
    );
    assert.equal(state.records[0].attendanceDate, "2026-10-10");
    assert.equal(state.updateFilters[0]._id, attendanceId);
    assert.equal(state.updateFilters[0].checkOutAt, null);
    assert.ok(
      state.updateFilters[0].checkInAt.$lte >= overnightRecord.checkInAt,
    );
  });
});

test("self check-out rejects missing, completed, or concurrent checkout records", async () => {
  for (const records of [
    [],
    [makeAttendance({ checkOutAt: new Date("2026-10-10T12:00:00.000Z") })],
  ]) {
    await withMocks({ records }, async () => {
      await assert.rejects(
        checkOutForEmployee({ _id: employeeUserId }, now),
        (error) => error.statusCode === 409,
      );
    });
  }

  await withMocks(
    {
      records: [
        makeAttendance(),
        makeAttendance({
          _id: "64b000000000000000000006",
          attendanceDate: "2026-10-09",
          checkInAt: new Date("2026-10-09T03:00:00.000Z"),
        }),
      ],
    },
    async (state) => {
      await assert.rejects(
        checkOutForEmployee({ _id: employeeUserId }, now),
        (error) => error.statusCode === 409,
      );
      assert.equal(state.updateFilters.length, 0);
      assert.equal(state.records.every((record) => record.checkOutAt === null), true);
    },
  );

  const record = makeAttendance();
  await withMocks({ records: [record] }, async () => {
    const results = await Promise.allSettled([
      checkOutForEmployee({ _id: employeeUserId }, now),
      checkOutForEmployee({ _id: employeeUserId }, now),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(
      results.find((result) => result.status === "rejected").reason.statusCode,
      409,
    );
  });
});

test("on-behalf recording enforces direct-report Supervisor scope", async () => {
  await withMocks({}, async () => {
    await assert.rejects(
      recordAttendanceForEmployee({
        employeeId,
        actor: actor("64b000000000000000000099", "supervisor"),
        now,
      }),
      (error) => error.statusCode === 403,
    );
  });
});

test("on-behalf creation rejects inactive Employee or linked User and duplicate dates", async () => {
  for (const employee of [
    makeEmployee({ employeeStatus: "on_leave" }),
    makeEmployee({ userStatus: "blocked" }),
  ]) {
    await withMocks({ employee }, async () => {
      await assert.rejects(
        recordAttendanceForEmployee({
          employeeId,
          actor: actor(adminId, "admin"),
          now,
        }),
        (error) => error.statusCode === 403,
      );
    });
  }

  await withMocks({ records: [makeAttendance()] }, async () => {
    await assert.rejects(
      recordAttendanceForEmployee({
        employeeId,
        actor: actor(adminId, "admin"),
        now,
      }),
      (error) => error.statusCode === 409,
    );
  });
});

test("Admin, superAdmin, and in-scope Supervisor can record on behalf", async () => {
  for (const serviceActor of [
    actor(adminId, "admin"),
    actor("64b000000000000000000006", "superAdmin"),
    actor(supervisorId, "supervisor"),
  ]) {
    await withMocks({}, async (state) => {
      const result = await recordAttendanceForEmployee({
        employeeId,
        actor: serviceActor,
        now,
      });
      assert.equal(result.attendance.employeeId, employeeId);
      assert.equal(result.attendance.checkInRecordedBy, serviceActor._id);
      assert.equal(result.attendance.checkInSource, serviceActor.userType);
      assert.equal(result.audit.actorId, serviceActor._id);
      assert.equal(state.records.length, 1);
      assert.equal(state.entryAudits.length, 1);
    });
  }
});

test("historical on-behalf timestamps require a reason and duplicate keys conflict", async () => {
  const input = {
    employeeId,
    actor: actor(adminId, "admin"),
    checkInAt: "2026-10-09T09:00:00+05:30",
    checkOutAt: "2026-10-09T18:00:00+05:30",
    now,
  };
  await withMocks({}, async (state) => {
    await assert.rejects(recordAttendanceForEmployee(input), (error) => error.statusCode === 400);
    await assert.rejects(
      recordAttendanceForEmployee({ ...input, reason: "   " }),
      (error) => error.statusCode === 400,
    );
    assert.equal(state.records.length, 0);

    const result = await recordAttendanceForEmployee({
      ...input,
      reason: "Approved manual attendance entry",
    });
    assert.equal(result.attendance.attendanceDate, "2026-10-09");
    assert.equal(result.attendance.checkOutRecordedBy, adminId);
    assert.equal(result.audit.attendanceId, result.attendance._id);
    assert.equal(result.audit.employeeId, employeeId);
    assert.equal(result.audit.actorId, adminId);
    assert.equal(result.audit.reason, "Approved manual attendance entry");
    assert.equal(
      result.audit.enteredValues.checkInAt.toISOString(),
      "2026-10-09T03:30:00.000Z",
    );
    assert.equal(
      result.audit.enteredValues.checkOutAt.toISOString(),
      "2026-10-09T12:30:00.000Z",
    );
    assert.ok(result.audit.recordedAt instanceof Date);
    assert.equal(state.records.length, 1);
    assert.equal(state.entryAudits.length, 1);
  });

  await withMocks(
    {
      records: [],
    },
    async (state) => {
      const originalCreate = Attendance.create;
      Attendance.create = async () => {
        throw { code: 11000 };
      };
      try {
        await assert.rejects(
          recordAttendanceForEmployee({
            ...input,
            reason: "Approved manual attendance entry",
          }),
          (error) => error.statusCode === 409,
        );
      } finally {
        Attendance.create = originalCreate;
      }
      assert.equal(state.records.length, 0);
      assert.equal(state.entryAudits.length, 0);
    },
  );
});

test("current on-behalf entry remains auditable with a null optional reason", async () => {
  await withMocks({}, async (state) => {
    const result = await recordAttendanceForEmployee({
      employeeId,
      actor: actor(supervisorId, "supervisor"),
      now,
    });
    assert.equal(result.audit.attendanceId, result.attendance._id);
    assert.equal(result.audit.employeeId, employeeId);
    assert.equal(result.audit.actorId, supervisorId);
    assert.equal(result.audit.reason, null);
    assert.equal(result.audit.enteredValues.attendanceDate, "2026-10-10");
    assert.equal(state.entryAudits.length, 1);
  });
});

test("failed manual-entry audit insert rolls back the attendance insert", async () => {
  await withMocks(
    { entryAuditInsertError: new Error("entry audit insert failed") },
    async (state) => {
      await assert.rejects(
        recordAttendanceForEmployee({
          employeeId,
          actor: actor(adminId, "admin"),
          checkInAt: "2026-10-09T09:00:00+05:30",
          reason: "Historical attendance approved",
          now,
        }),
        /entry audit insert failed/,
      );
      assert.equal(state.records.length, 0);
      assert.equal(state.entryAudits.length, 0);
    },
  );
});

test("on-behalf check-out enforces scope, chronology, and current business date", async () => {
  await withMocks({ records: [makeAttendance()] }, async (state) => {
    const result = await checkOutAttendanceForEmployee({
      employeeId,
      actor: actor(supervisorId, "supervisor"),
      now: new Date("2026-10-10T18:00:00.000Z"),
    });
    assert.equal(result.checkOutSource, "supervisor");
    assert.equal(state.updateFilters[0].attendanceDate, "2026-10-10");
  });

  await withMocks({ records: [makeAttendance()] }, async () => {
    await assert.rejects(
      checkOutAttendanceForEmployee({
        employeeId,
        actor: actor(adminId, "admin"),
        checkOutAt: "2026-10-10T02:00:00+05:30",
        reason: "Invalid historical checkout time",
        now,
      }),
      (error) => error.statusCode === 409,
    );
  });
});

test("only Admin and superAdmin can correct; correction preserves snapshots and supports reopening", async () => {
  const completed = makeAttendance({
    checkOutAt: new Date("2026-10-10T12:00:00.000Z"),
    checkOutRecordedBy: adminId,
    checkOutSource: "admin",
  });

  await withMocks({ records: [completed] }, async (state) => {
    await assert.rejects(
      correctAttendance({
        attendanceId,
        actor: actor(supervisorId, "supervisor"),
        reason: "Not allowed",
        checkOutAt: null,
      }),
      (error) => error.statusCode === 403,
    );
    assert.equal(state.corrections.length, 0);

    const result = await correctAttendance({
      attendanceId,
      actor: actor(adminId, "admin"),
      reason: "Reopen missed checkout",
      checkOutAt: null,
    });
    assert.equal(result.attendance.checkOutAt, null);
    assert.equal(result.attendance.checkOutRecordedBy, null);
    assert.equal(result.attendance.checkOutSource, null);
    assert.equal(result.correction.correctedBy, adminId);
    assert.equal(result.correction.reason, "Reopen missed checkout");
    assert.deepEqual(result.correction.originalValues, {
      checkInAt: completed.checkInAt,
      checkOutAt: completed.checkOutAt,
      attendanceDate: completed.attendanceDate,
    });
    assert.deepEqual(result.correction.revisedValues, {
      checkInAt: completed.checkInAt,
      checkOutAt: null,
      attendanceDate: completed.attendanceDate,
    });
    assert.equal(state.corrections.length, 1);
  });

  await withMocks({ records: [makeAttendance()] }, async () => {
    const result = await correctAttendance({
      attendanceId,
      actor: actor("64b000000000000000000006", "superAdmin"),
      reason: "Correct start time",
      checkInAt: "2026-10-10T09:30:00+05:30",
    });
    assert.equal(result.correction.correctedBy, "64b000000000000000000006");
  });

  await withMocks({ records: [makeAttendance()] }, async (state) => {
    const firstCorrection = await correctAttendance({
      attendanceId,
      actor: actor(adminId, "admin"),
      reason: "First adjustment",
      checkInAt: "2026-10-10T09:15:00+05:30",
    });
    const secondCorrection = await correctAttendance({
      attendanceId,
      actor: actor(adminId, "admin"),
      reason: "Second adjustment",
      checkInAt: "2026-10-10T09:20:00+05:30",
    });
    assert.notEqual(
      firstCorrection.correction._id.toString(),
      secondCorrection.correction._id.toString(),
    );
    assert.equal(state.corrections.length, 2);
    assert.equal(state.corrections[0].reason, "First adjustment");
    assert.equal(state.corrections[1].reason, "Second adjustment");
  });

  await withMocks({ records: [makeAttendance()] }, async () => {
    const result = await correctAttendance({
      attendanceId,
      actor: actor(adminId, "admin"),
      reason: "Resolve missed checkout",
      checkOutAt: "2026-10-10T18:00:00+05:30",
    });
    assert.equal(result.attendance.checkOutRecordedBy, adminId);
    assert.equal(result.attendance.checkOutSource, "admin");
  });
});

test("correction audit failure rolls back the attendance update", async () => {
  const original = makeAttendance();
  await withMocks(
    {
      records: [original],
      correctionInsertError: new Error("audit insert failed"),
    },
    async (state) => {
      await assert.rejects(
        correctAttendance({
          attendanceId,
          actor: actor(adminId, "admin"),
          reason: "Correct check-in",
          checkInAt: "2026-10-10T09:15:00+05:30",
        }),
        /audit insert failed/,
      );
      assert.equal(
        state.records[0].checkInAt.toISOString(),
        original.checkInAt.toISOString(),
      );
      assert.equal(state.corrections.length, 0);
    },
  );
});

test("competing corrections are rejected using compare-and-set state matching", async () => {
  const original = makeAttendance();
  await withMocks(
    {
      records: [original],
      findOneAndUpdateHook: async ({ filter, update, state }) => {
        if (
          state.records[0].checkInAt.getTime() !== filter.checkInAt.getTime()
        ) {
          return null;
        }
        Object.assign(state.records[0], update.$set);
        return state.records[0];
      },
    },
    async () => {
      const first = correctAttendance({
        attendanceId,
        actor: actor(adminId, "admin"),
        reason: "First correction",
        checkInAt: "2026-10-10T09:15:00+05:30",
      });
      const second = correctAttendance({
        attendanceId,
        actor: actor(adminId, "admin"),
        reason: "Competing correction",
        checkInAt: "2026-10-10T09:30:00+05:30",
      });
      const results = await Promise.allSettled([first, second]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(
        results.find((result) => result.status === "rejected").reason.statusCode,
        409,
      );
    },
  );
});
