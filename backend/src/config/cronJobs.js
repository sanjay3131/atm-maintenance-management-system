import cron from "node-cron";
import { cleanupOldPhotos } from "./cloudinaryCleanup.js";
import User from "../modules/users/user.model.js";
import {
  generateMonthlyAMC,
  markOverdueAMCs,
} from "../modules/amc/amc.service.js";
import { AMC_CONFIG } from "../modules/amc/amc.config.js";
import { generateRecurringJobs } from "../modules/jobs/recurringMaintenance.service.js";
import { MAINTENANCE_TIMEZONE } from "../modules/jobs/recurringMaintenance.utils.js";
import { processVehicleReminders } from "../modules/vehicles/vehicleReminderWorker.js";

export const initCronJobs = async () => {
  const tasks = [];
  const activeExecutions = new Map();
  let vehicleReminderPromise;
  let cleanupPromise;

  const trackTaskExecutions = (task) => {
    task.on("execution:started", (context) => {
      const { id } = context.execution;
      let resolveExecution;
      let rejectExecution;
      const promise = new Promise((resolve, reject) => {
        resolveExecution = resolve;
        rejectExecution = reject;
      });

      void promise.catch(() => {});
      activeExecutions.set(id, {
        promise,
        resolve: resolveExecution,
        reject: rejectExecution,
      });
    });

    const settleExecution = (context, failed) => {
      const { id, error } = context.execution;
      const activeExecution = activeExecutions.get(id);
      if (!activeExecution) return;

      activeExecutions.delete(id);
      if (failed) {
        activeExecution.reject(error);
      } else {
        activeExecution.resolve();
      }
    };

    task.on("execution:finished", (context) =>
      settleExecution(context, false),
    );
    task.on("execution:failed", (context) => settleExecution(context, true));
  };

  const registerTask = (expression, callback, options) => {
    const task = cron.createTask(expression, callback, options);
    tasks.push(task);
    trackTaskExecutions(task);
    task.start();
  };

  const cleanupTasks = () => {
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        const cleanupErrors = [];

        for (const task of tasks) {
          try {
            await task.stop();
          } catch (error) {
            cleanupErrors.push(error);
          }
        }

        for (const task of tasks) {
          try {
            await task.destroy();
          } catch (error) {
            cleanupErrors.push(error);
          }
        }

        const pendingExecutions = [
          ...[...activeExecutions.values()].map(({ promise }) => promise),
        ];
        if (vehicleReminderPromise) {
          pendingExecutions.push(vehicleReminderPromise);
        }

        const executionResults = await Promise.allSettled(pendingExecutions);
        for (const result of executionResults) {
          if (result.status === "rejected") {
            cleanupErrors.push(result.reason);
          }
        }

        if (cleanupErrors.length) {
          throw new AggregateError(cleanupErrors, "Cron task cleanup failed");
        }
      })();
    }

    return cleanupPromise;
  };

  const runVehicleReminderWorker = async () => {
    try {
      const result = await processVehicleReminders();
      console.log("[Cron] Vehicle reminder reconciliation completed:", result);
    } catch (error) {
      console.error("[Cron] Vehicle reminder reconciliation failed:", error);
    }
  };

  try {
    registerTask("*/15 * * * *", runVehicleReminderWorker, {
      timezone: "Asia/Kolkata",
    });

    // Cloudinary cleanup — daily at 2:00 AM
    registerTask("0 2 * * *", async () => {
      console.log("[Cron] Starting Cloudinary FIFO cleanup...");
      const result = await cleanupOldPhotos();
      console.log("[Cron] Cloudinary cleanup completed:", result);
    });

    // Generate today's daily/weekly recurring jobs at 12:05 AM India time.
    registerTask(
      "5 0 * * *",
      async () => {
        console.log("[Cron] Starting recurring maintenance job generation...");
        try {
          const result = await generateRecurringJobs();
          console.log(
            "[Cron] Recurring maintenance generation completed:",
            result,
          );
        } catch (err) {
          console.error("[Cron] Recurring maintenance generation failed:", err);
        }
      },
      { timezone: MAINTENANCE_TIMEZONE },
    );

    // AMC generation — 1st of every month at 1:00 AM
    registerTask(AMC_CONFIG.CRON.GENERATE, async () => {
      console.log("[Cron] Starting monthly AMC generation...");
      const now = new Date();
      try {
        const fallbackAdmin = await User.findOne({
          userType: { $in: ["admin", "superAdmin"] },
          status: "active",
        }).select("_id");

        const result = await generateMonthlyAMC(
          now.getMonth() + 1,
          now.getFullYear(),
          fallbackAdmin?._id || null,
        );
        console.log("[Cron] AMC generation completed:", result);
      } catch (err) {
        console.error("[Cron] AMC generation failed:", err);
      }
    });

    // AMC overdue check — daily at 8:00 AM
    registerTask(AMC_CONFIG.CRON.OVERDUE_CHECK, async () => {
      console.log("[Cron] Starting AMC overdue check...");
      try {
        const result = await markOverdueAMCs();
        console.log("[Cron] AMC overdue check completed:", result);
      } catch (err) {
        console.error("[Cron] AMC overdue check failed:", err);
      }
    });
  } catch (error) {
    try {
      await cleanupTasks();
    } catch (cleanupError) {
      console.error(
        "[Cron] Failed to clean up partially registered tasks:",
        cleanupError,
      );
    }
    throw error;
  }

  console.log(
    "[Cron] Scheduled jobs: Cloudinary cleanup (2AM), recurring maintenance generation (12:05AM IST), AMC generation (1st @ 1AM), AMC overdue check (8AM)",
  );

  vehicleReminderPromise = runVehicleReminderWorker();
  return cleanupTasks;
};
