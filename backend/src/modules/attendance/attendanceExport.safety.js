import { Transform } from "node:stream";
import ApiError from "../../utils/ApiError.js";

export const MAX_ATTENDANCE_EXPORT_DURATION_MS = 120_000;
export const MAX_ATTENDANCE_EXPORT_BYTES = 64 * 1024 * 1024;
export const MAX_CONCURRENT_ATTENDANCE_EXPORTS = 1;
export const MAX_ATTENDANCE_REPORT_QUERY_MS = 15_000;

let activeExports = 0;
const activeUsers = new Set();

export const assertAttendanceExportActive = ({ signal, deadline }) => {
  if (signal?.aborted) {
    throw new ApiError(499, "Attendance export was cancelled");
  }
  if (deadline !== undefined && Date.now() >= deadline) {
    throw new ApiError(504, "Attendance export exceeded its time limit");
  }
};

export const runAttendanceReportQuery = async (
  query,
  { signal, deadline } = {},
) => {
  assertAttendanceExportActive({ signal, deadline });
  const remainingMs =
    deadline === undefined ? MAX_ATTENDANCE_REPORT_QUERY_MS : deadline - Date.now();
  const maxTimeMs = Math.floor(
    Math.min(MAX_ATTENDANCE_REPORT_QUERY_MS, remainingMs),
  );
  if (maxTimeMs < 1) {
    throw new ApiError(504, "Attendance export exceeded its time limit");
  }

  try {
    const result = await query.maxTimeMS(maxTimeMs);
    assertAttendanceExportActive({ signal, deadline });
    return result;
  } catch (error) {
    if (deadline !== undefined && Date.now() >= deadline) {
      throw new ApiError(504, "Attendance export exceeded its time limit");
    }
    if (error?.code === 50 || error?.code === 262) {
      throw new ApiError(
        504,
        "Attendance report database query exceeded its time limit",
      );
    }
    throw error;
  }
};

export const withAttendanceExportSlot = async (userId, operation) => {
  const key = String(userId ?? "");
  if (!key || activeUsers.has(key)) {
    throw new ApiError(429, "An attendance export is already running for this user");
  }
  if (activeExports >= MAX_CONCURRENT_ATTENDANCE_EXPORTS) {
    throw new ApiError(429, "Attendance export capacity is currently full");
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

export const createAttendanceExportByteLimit = (maximumBytes) => {
  let writtenBytes = 0;
  const maximumLabel =
    maximumBytes >= 1024 * 1024
      ? `${(maximumBytes / (1024 * 1024)).toFixed(0)} MiB`
      : `${maximumBytes} bytes`;
  return new Transform({
    transform(chunk, encoding, callback) {
      writtenBytes += Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(chunk, encoding);
      if (writtenBytes > maximumBytes) {
        callback(
          new ApiError(
            413,
            `Generated attendance export exceeds the ${maximumLabel} output limit`,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
};
