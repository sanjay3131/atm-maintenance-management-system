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

export const initCronJobs = () => {
  // Cloudinary cleanup — daily at 2:00 AM
  cron.schedule("0 2 * * *", async () => {
    console.log("[Cron] Starting Cloudinary FIFO cleanup...");
    const result = await cleanupOldPhotos();
    console.log("[Cron] Cloudinary cleanup completed:", result);
  });

  // Generate today's daily/weekly recurring jobs at 12:05 AM India time.
  cron.schedule(
    "5 0 * * *",
    async () => {
      console.log("[Cron] Starting recurring maintenance job generation...");
      try {
        const result = await generateRecurringJobs();
        console.log("[Cron] Recurring maintenance generation completed:", result);
      } catch (err) {
        console.error("[Cron] Recurring maintenance generation failed:", err);
      }
    },
    { timezone: MAINTENANCE_TIMEZONE },
  );

  // AMC generation — 1st of every month at 1:00 AM
  cron.schedule(AMC_CONFIG.CRON.GENERATE, async () => {
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
  cron.schedule(AMC_CONFIG.CRON.OVERDUE_CHECK, async () => {
    console.log("[Cron] Starting AMC overdue check...");
    try {
      const result = await markOverdueAMCs();
      console.log("[Cron] AMC overdue check completed:", result);
    } catch (err) {
      console.error("[Cron] AMC overdue check failed:", err);
    }
  });

  console.log(
    "[Cron] Scheduled jobs: Cloudinary cleanup (2AM), recurring maintenance generation (12:05AM IST), AMC generation (1st @ 1AM), AMC overdue check (8AM)",
  );
};
