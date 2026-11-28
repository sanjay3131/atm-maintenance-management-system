import { createReadStream } from "node:fs";
import { stat, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import asyncHandler from "../../utils/asyncHandler.js";
import {
  generateRecurringCleaningExport,
  withCleaningExportSlot,
} from "./cleaningExport.service.js";

export const exportRecurringCleaningXlsx = asyncHandler(async (req, res) => {
  const abortController = new AbortController();
  const abortOnDisconnect = () => {
    if (!res.writableEnded) abortController.abort();
  };
  const onRequestAbort = () => abortController.abort();
  req.once("aborted", onRequestAbort);
  res.once("close", abortOnDisconnect);
  let generated;

  try {
    await withCleaningExportSlot(req.user?._id, async () => {
      generated = await generateRecurringCleaningExport({
        filters: req.validatedQuery,
        signal: abortController.signal,
      });
      const file = await stat(generated.filePath);
      if (abortController.signal.aborted) return;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
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
        res.destroy(new Error("Cleaning export download timed out"));
      });
      await pipeline(createReadStream(generated.filePath), res);
    });
  } catch (error) {
    if (abortController.signal.aborted || res.destroyed) return;
    if (res.headersSent) {
      console.error("[Cleaning Export] Download stream failed:", error);
      res.destroy(error);
      return;
    }
    throw error;
  } finally {
    req.removeListener("aborted", onRequestAbort);
    res.removeListener("close", abortOnDisconnect);
    if (generated?.directory) {
      await rm(generated.directory, { recursive: true, force: true });
    }
  }
});
