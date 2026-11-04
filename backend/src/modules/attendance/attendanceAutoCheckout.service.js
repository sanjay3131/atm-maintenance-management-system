import Attendance from "./attendance.model.js";

export const AUTO_CHECKOUT_AFTER_MS = 12 * 60 * 60 * 1000;
export const AUTO_CHECKOUT_BATCH_SIZE = 100;

const isValidDate = (value) =>
  value instanceof Date && Number.isFinite(value.getTime());

const buildDueFilter = (dueBefore, cursor) => ({
  employeeId: { $type: "objectId" },
  supervisorUserId: null,
  checkOutAt: null,
  checkInAt: { $type: "date", $lte: dueBefore },
  ...(cursor ? { _id: { $gt: cursor._id } } : {}),
});

export const processDueAttendanceCheckouts = async ({
  now = new Date(),
  batchSize = AUTO_CHECKOUT_BATCH_SIZE,
  onRecordError = () => {},
} = {}) => {
  if (!isValidDate(now)) {
    throw new TypeError("Automatic checkout requires a valid polling timestamp");
  }
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > AUTO_CHECKOUT_BATCH_SIZE
  ) {
    throw new RangeError(
      `Automatic checkout batch size must be between 1 and ${AUTO_CHECKOUT_BATCH_SIZE}`,
    );
  }

  const dueBefore = new Date(now.getTime() - AUTO_CHECKOUT_AFTER_MS);
  const result = {
    candidates: 0,
    updated: 0,
    raceLost: 0,
    failed: 0,
  };
  let cursor = null;

  while (true) {
    const records = await Attendance.find(buildDueFilter(dueBefore, cursor))
      .select("_id employeeId attendanceDate checkInAt")
      .sort({ _id: 1 })
      .limit(batchSize);

    if (records.length === 0) break;
    result.candidates += records.length;

    for (const record of records) {
      const originalCheckInAt = record.checkInAt;
      const checkoutDeadline = new Date(
        originalCheckInAt.getTime() + AUTO_CHECKOUT_AFTER_MS,
      );

      try {
        const updated = await Attendance.findOneAndUpdate(
          {
            _id: record._id,
            employeeId: record.employeeId,
            supervisorUserId: null,
            checkInAt: originalCheckInAt,
            checkOutAt: null,
            attendanceDate: record.attendanceDate,
          },
          {
            $set: {
              checkOutAt: checkoutDeadline,
              checkOutRecordedBy: null,
              checkOutSource: "system",
            },
          },
          { new: true, runValidators: true },
        );

        if (updated) result.updated += 1;
        else result.raceLost += 1;
      } catch (error) {
        result.failed += 1;
        onRecordError(error);
      }

      cursor = {
        _id: record._id,
      };
    }

    if (records.length < batchSize) break;
  }

  return result;
};
