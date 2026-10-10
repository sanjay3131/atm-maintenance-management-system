import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Attendance from "../src/modules/attendance/attendance.model.js";
import AttendanceCorrection from "../src/modules/attendance/attendanceCorrection.model.js";
import {
  attendanceCorrectionSchema,
  attendanceDateOnlySchema,
  attendanceRecordsQuerySchema,
  employeeIdParamsSchema,
  myAttendanceQuerySchema,
  onBehalfAttendanceEntrySchema,
  onBehalfAttendanceRecordSchema,
  onBehalfCheckInSchema,
  onBehalfCheckOutSchema,
  selfCheckInSchema,
  selfCheckOutSchema,
} from "../src/modules/attendance/attendance.validation.js";

const objectId = () => new mongoose.Types.ObjectId();

test("attendance date validation accepts real canonical calendar dates only", () => {
  assert.equal(attendanceDateOnlySchema.safeParse("2024-02-29").success, true);
  for (const value of [
    "2025-02-29",
    "2026-04-31",
    "2026-2-03",
    "03-02-2026",
    "2026-03-02T00:00:00Z",
  ]) {
    assert.equal(attendanceDateOnlySchema.safeParse(value).success, false, value);
  }
});

test("timestamp schemas require a valid ISO timestamp with an explicit offset", () => {
  for (const value of [
    "2026-10-10T09:00:00+05:30",
    "2026-10-10T03:30:00Z",
    "2026-10-10T09:00:00.123-04:00",
  ]) {
    assert.equal(
      onBehalfAttendanceEntrySchema.safeParse({ checkInAt: value }).success,
      true,
      value,
    );
  }

  assert.equal(
    onBehalfCheckOutSchema.safeParse({
      checkOutAt: "2026-10-10T18:00:00+05:30",
    }).success,
    true,
  );
  assert.equal(
    onBehalfCheckInSchema.safeParse({
      checkInAt: "2026-10-10T09:00:00",
    }).success,
    false,
  );
  assert.equal(
    onBehalfCheckOutSchema.safeParse({
      checkOutAt: "2026-10-10T18:00:00",
      location: "unaccepted",
    }).success,
    false,
  );

  for (const value of [
    "2026-10-10T09:00:00",
    "2026-02-30T09:00:00Z",
    "2026-10-10 09:00:00+05:30",
    "2026-10-10T25:00:00+05:30",
    "not-a-timestamp",
  ]) {
    assert.equal(
      onBehalfAttendanceEntrySchema.safeParse({ checkInAt: value }).success,
      false,
      value,
    );
  }
});

test("on-behalf entry rejects checkout earlier than check-in", () => {
  assert.equal(
    onBehalfAttendanceEntrySchema.safeParse({
      checkInAt: "2026-10-10T09:00:00+05:30",
      checkOutAt: "2026-10-10T08:59:59+05:30",
    }).success,
    false,
  );

  for (const extra of [
    { employeeId: objectId().toString() },
    { userId: objectId().toString() },
    { gps: { latitude: 10, longitude: 20 } },
    { location: { latitude: 10, longitude: 20 } },
  ]) {
    assert.equal(
      onBehalfAttendanceEntrySchema.safeParse({
        checkInAt: "2026-10-10T09:00:00+05:30",
        ...extra,
      }).success,
      false,
    );
  }
});

test("correction requires a bounded nonempty reason and at least one revised field", () => {
  const validCorrection = {
    reason: "Corrected at employee request",
    checkInAt: "2026-10-10T09:00:00+05:30",
  };
  assert.equal(attendanceCorrectionSchema.safeParse(validCorrection).success, true);

  for (const reason of ["", "   ", "r".repeat(1001)]) {
    assert.equal(
      attendanceCorrectionSchema.safeParse({
        ...validCorrection,
        reason,
      }).success,
      false,
    );
  }
  assert.equal(
    attendanceCorrectionSchema.safeParse({
      reason: "No values",
    }).success,
    false,
  );
});

test("correction permits explicit null checkout and validates resulting chronology", () => {
  assert.equal(
    attendanceCorrectionSchema.safeParse({
      reason: "Reopen attendance for correction",
      checkOutAt: null,
    }).success,
    true,
  );
  assert.equal(
    attendanceCorrectionSchema.safeParse({
      reason: "Incorrect order",
      checkInAt: "2026-10-10T09:00:00+05:30",
      checkOutAt: "2026-10-10T08:00:00+05:30",
    }).success,
    false,
  );
});

test("self-service request schemas reject caller-supplied identities and location fields", () => {
  assert.equal(selfCheckInSchema.safeParse({}).success, true);
  assert.equal(selfCheckOutSchema.safeParse({}).success, true);
  assert.deepEqual(selfCheckInSchema.safeParse(undefined), {
    success: true,
    data: {},
  });
  assert.deepEqual(selfCheckOutSchema.safeParse(undefined), {
    success: true,
    data: {},
  });

  for (const body of [
    { employeeId: objectId().toString() },
    { userId: objectId().toString() },
    { gps: { latitude: 10, longitude: 20 } },
    { location: { latitude: 10, longitude: 20 } },
  ]) {
    assert.equal(selfCheckInSchema.safeParse(body).success, false);
    assert.equal(selfCheckOutSchema.safeParse(body).success, false);
  }
});

test("correction schema rejects unknown identity, actor, and location fields", () => {
  const base = {
    reason: "Correcting attendance data",
    attendanceDate: "2026-10-10",
  };
  for (const extra of [
    { employeeId: objectId().toString() },
    { correctedBy: objectId().toString() },
    { gps: { latitude: 10, longitude: 20 } },
  ]) {
    assert.equal(
      attendanceCorrectionSchema.safeParse({ ...base, ...extra }).success,
      false,
    );
  }
});

test("attendance query and path schemas validate bounds, dates, and reject identity overrides", () => {
  const validSelfQuery = myAttendanceQuerySchema.safeParse({
    fromDate: "2026-10-01",
    toDate: "2026-10-31",
    page: "2",
    limit: "50",
  });
  assert.equal(validSelfQuery.success, true);
  assert.deepEqual(validSelfQuery.data, {
    fromDate: "2026-10-01",
    toDate: "2026-10-31",
    page: 2,
    limit: 50,
  });
  assert.equal(
    myAttendanceQuerySchema.safeParse({ page: "0" }).success,
    false,
  );
  assert.equal(
    myAttendanceQuerySchema.safeParse({ limit: "101" }).success,
    false,
  );
  assert.equal(
    myAttendanceQuerySchema.safeParse({
      fromDate: "2026-10-20",
      toDate: "2026-10-01",
    }).success,
    false,
  );
  assert.equal(
    myAttendanceQuerySchema.safeParse({
      employeeId: objectId().toString(),
    }).success,
    false,
  );
  assert.equal(
    attendanceRecordsQuerySchema.safeParse({
      employeeId: objectId().toString(),
    }).success,
    true,
  );
  assert.equal(
    employeeIdParamsSchema.safeParse({
      employeeId: "not-an-object-id",
    }).success,
    false,
  );
});

test("on-behalf body schema accepts optional reason and rejects client actor/location fields", () => {
  assert.equal(onBehalfAttendanceRecordSchema.safeParse({}).success, true);
  assert.equal(
    onBehalfAttendanceRecordSchema.safeParse({
      reason: "Approved manual record",
    }).success,
    true,
  );
  for (const extra of [
    { actorId: objectId().toString() },
    { userId: objectId().toString() },
    { gps: { latitude: 10, longitude: 20 } },
    { location: "unknown" },
  ]) {
    assert.equal(
      onBehalfAttendanceRecordSchema.safeParse(extra).success,
      false,
    );
  }
});

test("model definitions contain required references, validation, timestamps, and indexes", async () => {
  const attendanceIndexes = Attendance.schema.indexes();
  assert.ok(
    attendanceIndexes.some(
      ([keys, options]) =>
        keys.employeeId === 1 &&
        keys.attendanceDate === 1 &&
        options.unique === true,
    ),
  );
  assert.ok(
    attendanceIndexes.some(([keys]) => keys.attendanceDate === 1),
  );
  assert.equal(Attendance.schema.options.timestamps, true);
  assert.equal(Attendance.schema.path("employeeId").options.ref, "Employee");
  assert.equal(Attendance.schema.path("checkInRecordedBy").options.ref, "User");

  const correctionIndexes = AttendanceCorrection.schema.indexes();
  assert.ok(
    correctionIndexes.some(
      ([keys]) => keys.attendanceId === 1 && keys.correctedAt === -1,
    ),
  );
  assert.equal(AttendanceCorrection.schema.options.timestamps, true);

  const attendance = new Attendance({
    employeeId: objectId(),
    attendanceDate: "2026-02-30",
    checkInAt: new Date("2026-10-10T03:30:00.000Z"),
    checkInRecordedBy: objectId(),
    checkInSource: "employee",
  });
  await assert.rejects(attendance.validate(), /attendanceDate/);

  const invalidChronology = new Attendance({
    employeeId: objectId(),
    attendanceDate: "2026-10-10",
    checkInAt: new Date("2026-10-10T10:00:00.000Z"),
    checkOutAt: new Date("2026-10-10T09:00:00.000Z"),
    checkInRecordedBy: objectId(),
    checkInSource: "employee",
  });
  await assert.rejects(invalidChronology.validate(), /checkOutAt/);

  const incompleteCheckout = new Attendance({
    employeeId: objectId(),
    attendanceDate: "2026-10-10",
    checkInAt: new Date("2026-10-10T03:30:00.000Z"),
    checkOutAt: new Date("2026-10-10T12:30:00.000Z"),
    checkInRecordedBy: objectId(),
    checkInSource: "employee",
  });
  await assert.rejects(incompleteCheckout.validate(), /checkOutAt/);

  const correction = new AttendanceCorrection({
    attendanceId: objectId(),
    employeeId: objectId(),
    reason: "  corrected value  ",
    originalValues: {
      checkInAt: new Date("2026-10-10T03:30:00.000Z"),
      checkOutAt: null,
      attendanceDate: "2026-10-10",
    },
    revisedValues: {
      checkInAt: new Date("2026-10-10T03:30:00.000Z"),
      checkOutAt: null,
      attendanceDate: "2026-10-10",
    },
    correctedBy: objectId(),
  });
  await correction.validate();
  assert.equal(correction.reason, "corrected value");
  assert.ok(correction.correctedAt instanceof Date);
});

test("checkout chronology validator supports document and atomic query-update contexts", () => {
  const validator = Attendance.schema
    .path("checkOutAt")
    .validators.find((entry) => entry.type === "user defined").validator;
  const checkInAt = new Date("2026-10-10T03:00:00.000Z");
  const checkOutAt = new Date("2026-10-10T18:00:00.000Z");
  const earlierCheckOutAt = new Date("2026-10-10T02:59:59.000Z");

  assert.equal(validator.call({ checkInAt }, checkOutAt), true);
  assert.equal(validator.call({ checkInAt }, earlierCheckOutAt), false);

  const checkoutQuery = new mongoose.Query();
  checkoutQuery.setUpdate({ $set: { checkOutAt } });
  checkoutQuery.setQuery({ checkInAt: { $lte: checkOutAt } });
  assert.equal(validator.call(checkoutQuery, checkOutAt), true);

  const invalidCheckoutQuery = new mongoose.Query();
  invalidCheckoutQuery.setUpdate({ $set: { checkOutAt } });
  invalidCheckoutQuery.setQuery({
    checkInAt: { $lte: new Date("2026-10-10T18:00:01.000Z") },
  });
  assert.equal(validator.call(invalidCheckoutQuery, checkOutAt), false);
});
