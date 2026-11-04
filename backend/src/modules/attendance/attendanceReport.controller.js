import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { getAttendanceReport } from "./attendanceReport.api.service.js";
import {
  generateAttendanceReportExport,
  removeAttendanceExportFiles,
} from "./attendanceReport.export.service.js";
import { withAttendanceExportSlot } from "./attendanceExport.safety.js";

export const getAttendanceReportRecords = asyncHandler(async (req, res) => {
  const result = await getAttendanceReport(req.validatedQuery);
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        result,
        "Attendance report retrieved successfully",
      ),
    );
});

const exportAttendanceReport = (format) =>
    asyncHandler(async (req, res) => {
      const abortController = new AbortController();
      const abortOnDisconnect = () => {
        if (!res.writableEnded) abortController.abort();
      };
      const onRequestAbort = () => abortController.abort();
      req.once("aborted", onRequestAbort);
      res.once("close", abortOnDisconnect);
      let generated;

      try {
        await withAttendanceExportSlot(req.user?._id, async () => {
          generated = await generateAttendanceReportExport({
            format,
            query: req.validatedQuery,
            signal: abortController.signal,
          });
          const file = await stat(generated.filePath);
          if (abortController.signal.aborted) return;

          res.setHeader("Content-Type", generated.contentType);
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${generated.filename}"`,
          );
          res.setHeader("Content-Length", file.size);
          res.setHeader("Cache-Control", "private, no-store");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.setTimeout(120_000, () => {
            abortController.abort();
            res.destroy(new Error("Attendance export download timed out"));
          });
          await pipeline(createReadStream(generated.filePath), res);
        });
      } catch (error) {
        if (abortController.signal.aborted || res.destroyed) return;
        if (res.headersSent) {
          console.error("[Attendance Report Export] Download stream failed:", error);
          res.destroy(error);
          return;
        }
        throw error;
      } finally {
        req.removeListener("aborted", onRequestAbort);
        res.removeListener("close", abortOnDisconnect);
        if (generated?.directory) {
          await removeAttendanceExportFiles(generated.directory);
        }
      }
    });

export const exportAttendanceReportXlsx = exportAttendanceReport("xlsx");
export const exportAttendanceReportPdf = exportAttendanceReport("pdf");
