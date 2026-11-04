import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import path from "node:path";
import connectDb from "../../config/db.js";
import { processDueAttendanceCheckouts } from "./attendanceAutoCheckout.service.js";

const POLL_INTERVAL_MS = 60 * 1000;
const SHUTDOWN_TIMEOUT_MS = 10 * 1000;

const getErrorName = (error) =>
  typeof error?.name === "string" ? error.name : "Error";

export const startAttendanceAutoCheckoutWorker = async ({
  connect = connectDb,
  database = mongoose,
  runCycle = processDueAttendanceCheckouts,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  signalSource = process,
  logger = console,
  shutdownTimeoutMs = SHUTDOWN_TIMEOUT_MS,
} = {}) => {
  await connect();
  if (database.connection.readyState !== 1) {
    throw new Error("MongoDB did not connect; automatic checkout worker cannot start");
  }

  let stopping = false;
  let activeCycle = null;
  let stopPromise = null;
  const startedAt = Date.now();

  const poll = async () => {
    if (stopping) return;
    if (activeCycle) {
      logger.warn("[AttendanceAutoCheckout] Skipping overlapping poll");
      return activeCycle;
    }

    const cycleStartedAt = Date.now();
    const cycle = Promise.resolve()
      .then(() =>
        runCycle({
          now: new Date(),
          onRecordError: (error) =>
            logger.error("[AttendanceAutoCheckout] Record update failed", {
              error: getErrorName(error),
            }),
        }),
      )
      .then((result) => {
        logger.info("[AttendanceAutoCheckout] Poll completed", {
          ...result,
          durationMs: Date.now() - cycleStartedAt,
        });
        return result;
      })
      .catch((error) => {
        logger.error("[AttendanceAutoCheckout] Poll failed", {
          error: getErrorName(error),
          durationMs: Date.now() - cycleStartedAt,
        });
        return null;
      })
      .finally(() => {
        activeCycle = null;
      });

    activeCycle = cycle;
    return cycle;
  };

  const stop = () => {
    if (stopPromise) return stopPromise;
    stopping = true;
    clearIntervalFn(timer);
    signalSource.removeListener?.("SIGTERM", onSigterm);
    signalSource.removeListener?.("SIGINT", onSigint);
    logger.info("[AttendanceAutoCheckout] Shutdown requested");

    stopPromise = (async () => {
      if (activeCycle) {
        let timeout;
        const timedOut = await Promise.race([
          activeCycle.then(() => false),
          new Promise((resolve) => {
            timeout = setTimeout(() => resolve(true), shutdownTimeoutMs);
          }),
        ]);
        clearTimeout(timeout);
        if (timedOut) {
          logger.error("[AttendanceAutoCheckout] Shutdown wait timed out");
        }
      }

      await database.disconnect();
      logger.info("[AttendanceAutoCheckout] Worker stopped");
    })();
    return stopPromise;
  };

  const onSigterm = () => {
    void stop().catch((error) => {
      logger.error("[AttendanceAutoCheckout] Shutdown failed", {
        error: getErrorName(error),
      });
      process.exitCode = 1;
    });
  };
  const onSigint = onSigterm;

  const timer = setIntervalFn(() => {
    void poll();
  }, POLL_INTERVAL_MS);

  signalSource.on("SIGTERM", onSigterm);
  signalSource.on("SIGINT", onSigint);

  logger.info("[AttendanceAutoCheckout] Worker started", {
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: 100,
    startedAt: new Date(startedAt).toISOString(),
  });
  void poll();

  return { stop, poll };
};

const runWorker = async () => {
  try {
    await startAttendanceAutoCheckoutWorker();
  } catch (error) {
    console.error("[AttendanceAutoCheckout] Worker startup failed", {
      error: getErrorName(error),
      message: error?.message ?? "Unknown error",
    });
    process.exitCode = 1;
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch((disconnectError) => {
        console.error("[AttendanceAutoCheckout] Startup cleanup failed", {
          error: getErrorName(disconnectError),
        });
      });
    }
  }
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runWorker();
}
