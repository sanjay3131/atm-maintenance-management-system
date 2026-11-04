import test from "node:test";
import assert from "node:assert/strict";
import { calculateAttendanceStatus } from "../src/modules/attendance/attendanceStatus.js";

const checkInAt = new Date("2026-10-10T00:00:00.000Z");
const sixHours = 6 * 60 * 60 * 1000;

const calculate = ({ durationMs, checkOutAt = null, asOf }) =>
  calculateAttendanceStatus({
    checkInAt,
    checkOutAt:
      checkOutAt === null
        ? null
        : new Date(checkInAt.getTime() + durationMs),
    asOf: asOf ?? new Date(checkInAt.getTime() + durationMs),
  });

test("attendance status is incomplete at 5h 59m and present at six hours", () => {
  assert.deepEqual(
    calculate({ durationMs: 5 * 60 * 60 * 1000 + 59 * 60 * 1000 }),
    {
      calculatedStatus: "incomplete",
      workedDurationMs: 5 * 60 * 60 * 1000 + 59 * 60 * 1000,
    },
  );
  assert.deepEqual(calculate({ durationMs: sixHours }), {
    calculatedStatus: "present",
    workedDurationMs: sixHours,
  });
  assert.equal(
    calculate({ durationMs: sixHours + 1 }).calculatedStatus,
    "present",
  );
});

test("open attendance uses the supplied server timestamp and clamps future check-in", () => {
  assert.deepEqual(
    calculate({
      durationMs: 0,
      asOf: new Date(checkInAt.getTime() + sixHours - 1),
    }),
    {
      calculatedStatus: "incomplete",
      workedDurationMs: sixHours - 1,
    },
  );
  assert.deepEqual(
    calculate({
      durationMs: 0,
      asOf: new Date(checkInAt.getTime() + sixHours),
    }),
    {
      calculatedStatus: "present",
      workedDurationMs: sixHours,
    },
  );
  assert.deepEqual(
    calculate({
      durationMs: 0,
      asOf: new Date(checkInAt.getTime() - 1),
    }),
    { calculatedStatus: "incomplete", workedDurationMs: 0 },
  );
});

test("closed attendance duration comes from persisted timestamps, not asOf", () => {
  const checkOutAt = new Date(checkInAt.getTime() + sixHours - 1);
  assert.deepEqual(
    calculateAttendanceStatus({
      checkInAt,
      checkOutAt,
      asOf: new Date(checkInAt.getTime() + sixHours * 10),
    }),
    {
      calculatedStatus: "incomplete",
      workedDurationMs: sixHours - 1,
    },
  );
});

test("invalid timestamps and checkout before check-in are rejected", () => {
  assert.throws(
    () =>
      calculateAttendanceStatus({
        checkInAt: new Date(Number.NaN),
        checkOutAt: null,
        asOf: new Date(),
      }),
    /check-in timestamp/,
  );
  assert.throws(
    () =>
      calculateAttendanceStatus({
        checkInAt,
        checkOutAt: "2026-10-10T06:00:00.000Z",
        asOf: new Date(),
      }),
    /check-out timestamp/,
  );
  assert.throws(
    () =>
      calculateAttendanceStatus({
        checkInAt,
        checkOutAt: new Date(checkInAt.getTime() - 1),
        asOf: new Date(),
      }),
    /earlier than check-in/,
  );
  assert.throws(
    () =>
      calculateAttendanceStatus({
        checkInAt,
        checkOutAt: null,
        asOf: new Date(Number.NaN),
      }),
    /calculation timestamp/,
  );
});
