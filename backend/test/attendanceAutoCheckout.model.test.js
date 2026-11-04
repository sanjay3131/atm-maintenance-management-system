import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Attendance from "../src/modules/attendance/attendance.model.js";

const objectId = () => new mongoose.Types.ObjectId();

const makeAttendance = (checkout = {}) =>
  new Attendance({
    employeeId: objectId(),
    attendanceDate: "2026-10-10",
    checkInAt: new Date("2026-10-10T03:00:00.000Z"),
    checkInRecordedBy: objectId(),
    checkInSource: "employee",
    ...checkout,
  });

test("system checkout is valid with an exact timestamp and no human recorder", async () => {
  const attendance = makeAttendance({
    checkOutAt: new Date("2026-10-10T15:00:00.000Z"),
    checkOutRecordedBy: null,
    checkOutSource: "system",
  });

  await attendance.validate();
  assert.equal(attendance.checkOutSource, "system");
  assert.equal(attendance.checkOutRecordedBy, null);
});

test("system source without a checkout timestamp is invalid", async () => {
  const attendance = makeAttendance({
    checkOutAt: null,
    checkOutRecordedBy: null,
    checkOutSource: "system",
  });

  await assert.rejects(attendance.validate(), /checkOutAt|checkOutSource/);
});

test("existing human checkout sources still require timestamp and recorder", async () => {
  for (const source of ["employee", "supervisor", "admin", "superAdmin"]) {
    const attendance = makeAttendance({
      checkOutAt: new Date("2026-10-10T12:00:00.000Z"),
      checkOutRecordedBy: objectId(),
      checkOutSource: source,
    });
    await attendance.validate();
    assert.equal(attendance.checkOutSource, source);
  }
});

test("invalid checkout timestamp, source, and recorder combinations are rejected", async () => {
  const invalidCombinations = [
    { checkOutAt: new Date("2026-10-10T12:00:00.000Z") },
    { checkOutRecordedBy: objectId() },
    {
      checkOutAt: new Date("2026-10-10T12:00:00.000Z"),
      checkOutSource: "employee",
    },
    {
      checkOutAt: null,
      checkOutRecordedBy: null,
      checkOutSource: "employee",
    },
    {
      checkOutAt: new Date("2026-10-10T12:00:00.000Z"),
      checkOutRecordedBy: objectId(),
      checkOutSource: "system",
    },
  ];

  for (const combination of invalidCombinations) {
    await assert.rejects(makeAttendance(combination).validate());
  }
});
