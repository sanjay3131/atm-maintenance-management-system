import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Attendance from "../src/modules/attendance/attendance.model.js";
import {
  AUTO_CHECKOUT_AFTER_MS,
  AUTO_CHECKOUT_BATCH_SIZE,
  processDueAttendanceCheckouts,
} from "../src/modules/attendance/attendanceAutoCheckout.service.js";

const now = new Date("2026-10-10T12:00:00.000Z");
const makeRecord = (id, checkInAt, overrides = {}) => ({
  _id: id,
  employeeId: new mongoose.Types.ObjectId(),
  attendanceDate: "2026-10-10",
  checkInAt,
  checkOutAt: null,
  checkOutRecordedBy: null,
  checkOutSource: null,
  ...overrides,
});

const sameDate = (left, right) =>
  left instanceof Date &&
  right instanceof Date &&
  left.getTime() === right.getTime();

async function withAttendanceMocks(records, callback, { beforeUpdate } = {}) {
  const originals = {
    find: Attendance.find,
    findOneAndUpdate: Attendance.findOneAndUpdate,
  };
  const state = {
    records: records.map((record) => ({ ...record })),
    filters: [],
    findFilters: [],
    batchLimits: [],
    updates: [],
    beforeUpdate,
  };

  Attendance.find = (filter) => {
    state.filters.push(filter);
    state.findFilters.push(filter);
    let sortOrder = { checkInAt: 1, _id: 1 };
    return {
      select() {
        return this;
      },
      sort(value) {
        sortOrder = value;
        return this;
      },
      limit(limit) {
        state.batchLimits.push(limit);
        let matches = state.records.filter((record) =>
          Object.entries(filter).every(([field, condition]) => {
            if (field === "_id" && condition?.$gt) {
              return String(record._id) > String(condition.$gt);
            }
            if (field === "employeeId" && condition?.$type === "objectId") {
              return record.employeeId instanceof mongoose.Types.ObjectId;
            }
            if (field === "supervisorUserId" && condition === null) {
              return record.supervisorUserId == null;
            }
            if (field === "checkOutAt" && condition === null) {
              return record.checkOutAt == null;
            }
            if (
              field === "checkInAt" &&
              condition?.$type === "date" &&
              condition.$lte instanceof Date
            ) {
              return (
                record.checkInAt instanceof Date &&
                record.checkInAt <= condition.$lte
              );
            }
            return false;
          }),
        );
        matches.sort((left, right) => {
          if (sortOrder._id) {
            return String(left._id).localeCompare(String(right._id));
          }
          return left.checkInAt - right.checkInAt;
        });
        return Promise.resolve(matches.slice(0, limit));
      },
    };
  };

  Attendance.findOneAndUpdate = async (filter, update, options) => {
    state.updates.push({ filter, update, options });
    await state.beforeUpdate?.({ filter, update, state });
    const record = state.records.find(
      (candidate) =>
        String(candidate._id) === String(filter._id) &&
        String(candidate.employeeId) === String(filter.employeeId) &&
        candidate.supervisorUserId == null &&
        sameDate(candidate.checkInAt, filter.checkInAt) &&
        candidate.checkOutAt == null &&
        candidate.attendanceDate === filter.attendanceDate,
    );
    if (!record) return null;
    Object.assign(record, update.$set);
    return record;
  };

  try {
    await callback(state);
  } finally {
    Attendance.find = originals.find;
    Attendance.findOneAndUpdate = originals.findOneAndUpdate;
  }
}

test("due selection respects the exact 12-hour boundary and excludes supervisors and closed records", async () => {
  const exactlyDue = makeRecord(
    "exact",
    new Date(now.getTime() - AUTO_CHECKOUT_AFTER_MS),
  );
  const older = makeRecord(
    "older",
    new Date(now.getTime() - AUTO_CHECKOUT_AFTER_MS - 1),
  );
  const notDue = makeRecord(
    "not-due",
    new Date(now.getTime() - AUTO_CHECKOUT_AFTER_MS + 1),
  );
  const supervisor = makeRecord(
    "supervisor",
    new Date(now.getTime() - AUTO_CHECKOUT_AFTER_MS),
    { employeeId: null, supervisorUserId: "supervisor-id" },
  );
  const manuallyClosed = makeRecord(
    "closed",
    new Date(now.getTime() - AUTO_CHECKOUT_AFTER_MS),
    {
      checkOutAt: new Date(now.getTime() - 1),
      checkOutRecordedBy: "human-user",
      checkOutSource: "employee",
    },
  );

  await withAttendanceMocks(
    [exactlyDue, older, notDue, supervisor, manuallyClosed],
    async (state) => {
      const result = await processDueAttendanceCheckouts({ now });
      assert.equal(state.findFilters.length, 1);
      assert.deepEqual(state.findFilters[0].employeeId, { $type: "objectId" });
      assert.equal(state.findFilters[0].supervisorUserId, null);
      assert.deepEqual(result, {
        candidates: 2,
        updated: 2,
        raceLost: 0,
        failed: 0,
      });
      assert.deepEqual(
        state.updates.map(({ filter }) => filter._id),
        ["exact", "older"],
      );
      assert.equal(
        state.records.some((record) => record._id === "supervisor" && record.checkOutAt),
        false,
      );
    },
  );
});

test("checkout persists the original check-in plus 12 hours, not the later polling time", async () => {
  const checkInAt = new Date(now.getTime() - AUTO_CHECKOUT_AFTER_MS - 1234);
  const record = makeRecord("late-poll", checkInAt);

  await withAttendanceMocks([record], async (state) => {
    await processDueAttendanceCheckouts({ now });
    const checkoutAt = new Date(checkInAt.getTime() + AUTO_CHECKOUT_AFTER_MS);
    assert.equal(state.records[0].checkOutAt.getTime(), checkoutAt.getTime());
    assert.ok(state.records[0].checkOutAt < now);
    assert.equal(state.records[0].checkOutSource, "system");
    assert.equal(state.records[0].checkOutRecordedBy, null);
    assert.equal(state.updates[0].filter.checkInAt.getTime(), checkInAt.getTime());
    assert.equal(state.updates[0].filter.attendanceDate, "2026-10-10");
    assert.equal(state.updates[0].options.runValidators, true);
  });
});

test("uses keyset batches without skipping due records and never exceeds the batch limit", async () => {
  const records = Array.from({ length: 7 }, (_, index) =>
    makeRecord(
      `record-${index}`,
      new Date(now.getTime() - AUTO_CHECKOUT_AFTER_MS - index * 1000),
    ),
  );

  await withAttendanceMocks(records, async (state) => {
    const result = await processDueAttendanceCheckouts({
      now,
      batchSize: 2,
    });
    assert.equal(result.candidates, 7);
    assert.equal(result.updated, 7);
    assert.deepEqual(
      state.updates.map(({ filter }) => filter._id).sort(),
      records.map(({ _id }) => _id).sort(),
    );
    assert.ok(state.batchLimits.every((limit) => limit === 2));
    assert.ok(state.filters.length >= 4);
  });
});

test("conditional update loses safely to manual checkout or a concurrent correction", async () => {
  for (const [index, mutate] of [
    (record) => {
      record.checkOutAt = new Date(now.getTime() - 1000);
    },
    (record) => {
      record.checkInAt = new Date(record.checkInAt.getTime() + 1);
    },
    (record) => {
      record.attendanceDate = "2026-10-09";
    },
  ].entries()) {
    const record = makeRecord(
      `race-${index}`,
      new Date(now.getTime() - AUTO_CHECKOUT_AFTER_MS),
    );
    await withAttendanceMocks(
      [record],
      async () => {
        const result = await processDueAttendanceCheckouts({ now });
        assert.deepEqual(result, {
          candidates: 1,
          updated: 0,
          raceLost: 1,
          failed: 0,
        });
      },
      {
        beforeUpdate: ({ state }) => mutate(state.records[0]),
      },
    );
  }
});

test("failed candidates do not block later records and remain eligible for a later poll", async () => {
  const records = ["first", "second", "third"].map((id, index) =>
    makeRecord(
      id,
      new Date(now.getTime() - AUTO_CHECKOUT_AFTER_MS - index * 1000),
    ),
  );
  let shouldFail = true;
  const errors = [];

  await withAttendanceMocks(
    records,
    async (state) => {
      const firstPass = await processDueAttendanceCheckouts({
        now,
        batchSize: 2,
        onRecordError: (error) => errors.push(error.message),
      });
      assert.deepEqual(firstPass, {
        candidates: 3,
        updated: 2,
        raceLost: 0,
        failed: 1,
      });
      assert.equal(errors.length, 1);
      shouldFail = false;

      const secondPass = await processDueAttendanceCheckouts({ now });
      assert.deepEqual(secondPass, {
        candidates: 1,
        updated: 1,
        raceLost: 0,
        failed: 0,
      });
      assert.ok(state.records.every((record) => record.checkOutAt));

      const thirdPass = await processDueAttendanceCheckouts({ now });
      assert.deepEqual(thirdPass, {
        candidates: 0,
        updated: 0,
        raceLost: 0,
        failed: 0,
      });
    },
    {
      beforeUpdate: ({ filter }) => {
        if (filter._id === "first" && shouldFail) {
          throw new Error("temporary update failure");
        }
      },
    },
  );
});

test("rejects invalid time and unbounded batch sizes", async () => {
  await assert.rejects(
    processDueAttendanceCheckouts({ now: "not-a-date" }),
    /valid polling timestamp/,
  );
  await assert.rejects(
    processDueAttendanceCheckouts({
      now,
      batchSize: AUTO_CHECKOUT_BATCH_SIZE + 1,
    }),
    /batch size/,
  );
});
