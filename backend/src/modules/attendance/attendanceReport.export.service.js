import { lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ApiError from "../../utils/ApiError.js";
import { createCompleteAttendanceReport } from "./attendanceReport.api.service.js";
import {
  assertAttendanceExportActive,
  MAX_ATTENDANCE_EXPORT_DURATION_MS,
} from "./attendanceExport.safety.js";
import { writeAttendanceWorkbook } from "./attendanceReport.excel.js";
import { writeAttendancePdf } from "./attendanceReport.pdf.js";

export const ABANDONED_EXPORT_DIRECTORY_MAX_AGE_MS =
  7 * 24 * 60 * 60 * 1000;
const EXPORT_DIRECTORY_PATTERN =
  /^atm-attendance-export-(\d+)-[A-Za-z0-9_-]+$/;
let staleDirectoryCleanup;

const EXPORTS = {
  xlsx: {
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
    writer: writeAttendanceWorkbook,
  },
  pdf: {
    contentType: "application/pdf",
    extension: "pdf",
    writer: writeAttendancePdf,
  },
};

const isProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
};

export const cleanupAbandonedAttendanceExportDirectories = async ({
  tempDirectory = os.tmpdir(),
  now = Date.now(),
  maxAgeMs = ABANDONED_EXPORT_DIRECTORY_MAX_AGE_MS,
  logger = console,
} = {}) => {
  let entries;
  try {
    entries = await readdir(tempDirectory, { withFileTypes: true });
  } catch (error) {
    logger.warn?.(
      "[Attendance Report Export] Could not inspect stale export directories:",
      error,
    );
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    const match = EXPORT_DIRECTORY_PATTERN.exec(entry.name);
    if (!match || !entry.isDirectory()) continue;
    const ownerPid = Number(match[1]);
    if (!Number.isSafeInteger(ownerPid) || ownerPid < 1 || isProcessAlive(ownerPid)) {
      continue;
    }

    const directory = path.join(tempDirectory, entry.name);
    try {
      const metadata = await lstat(directory);
      if (
        !metadata.isDirectory() ||
        now - metadata.mtimeMs <= maxAgeMs
      ) {
        continue;
      }
      await rm(directory, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        logger.warn?.(
          "[Attendance Report Export] Could not remove an abandoned export directory:",
          error,
        );
      }
    }
  }
  return removed;
};

const cleanupStaleDirectoriesOnce = () => {
  staleDirectoryCleanup ??= cleanupAbandonedAttendanceExportDirectories();
  return staleDirectoryCleanup;
};

export const generateAttendanceReportExport = async ({
  format,
  query,
  signal,
  tempDirectory = os.tmpdir(),
}) => {
  const exportFormat = EXPORTS[format];
  if (!exportFormat) throw new ApiError(400, "Unsupported attendance export format");

  const startedAt = Date.now();
  const deadline = startedAt + MAX_ATTENDANCE_EXPORT_DURATION_MS;
  assertAttendanceExportActive({ signal, deadline });
  await cleanupStaleDirectoriesOnce();
  assertAttendanceExportActive({ signal, deadline });
  const reportPlan = await createCompleteAttendanceReport({
    ...query,
    signal,
    deadline,
  });
  reportPlan.employeeId = query.employeeId ?? null;
  reportPlan.periodType = query.periodType;
  const directory = await mkdtemp(
    path.join(tempDirectory, `atm-attendance-export-${process.pid}-`),
  );
  const outputPath = path.join(directory, `attendance-report.${exportFormat.extension}`);
  const spoolPath = path.join(directory, "attendance-report.jsonl");

  try {
    assertAttendanceExportActive({ signal, deadline });
    await exportFormat.writer({
      reportPlan,
      periodType: query.periodType,
      outputPath,
      spoolPath,
      signal,
      deadline,
    });
    assertAttendanceExportActive({ signal, deadline });
    return {
      directory,
      filePath: outputPath,
      contentType: exportFormat.contentType,
      filename: `attendance-report-${query.fromDate}.${exportFormat.extension}`,
      generatedAt: new Date(),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch((cleanupError) => {
      console.warn(
        "[Attendance Report Export] Could not remove failed export files:",
        cleanupError,
      );
    });
    throw error;
  }
};

export const removeAttendanceExportFiles = async (directory) => {
  if (!directory) return;
  await rm(directory, { recursive: true, force: true }).catch((error) => {
    if (error?.code !== "ENOENT") {
      console.warn(
        "[Attendance Report Export] Could not remove delivered export files:",
        error,
      );
    }
  });
};
