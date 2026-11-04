const SIX_HOURS_IN_MS = 6 * 60 * 60 * 1000;

const isValidDate = (value) =>
  value instanceof Date && Number.isFinite(value.getTime());

export const calculateAttendanceStatus = ({
  checkInAt,
  checkOutAt,
  asOf,
}) => {
  if (!isValidDate(checkInAt)) {
    throw new TypeError("Attendance check-in timestamp must be a valid Date");
  }
  if (checkOutAt !== null && !isValidDate(checkOutAt)) {
    throw new TypeError("Attendance check-out timestamp must be a valid Date or null");
  }
  if (!isValidDate(asOf)) {
    throw new TypeError("Attendance calculation timestamp must be a valid Date");
  }
  if (checkOutAt && checkOutAt < checkInAt) {
    throw new RangeError("Attendance check-out cannot be earlier than check-in");
  }

  const workedDurationMs =
    checkOutAt === null
      ? Math.max(0, asOf.getTime() - checkInAt.getTime())
      : checkOutAt.getTime() - checkInAt.getTime();

  return {
    calculatedStatus:
      workedDurationMs >= SIX_HOURS_IN_MS ? "present" : "incomplete",
    workedDurationMs,
  };
};
