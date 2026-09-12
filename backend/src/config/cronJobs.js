import cron from "node-cron";
import { cleanupOldPhotos } from "./cloudinaryCleanup.js";
import User from "../modules/users/user.model.js";
import {
  generateMonthlyAMC,
  markOverdueAMCs,
} from "../modules/amc/amc.service.js";
import { AMC_CONFIG } from "../modules/amc/amc.config.js";

export const initCronJobs = () => {
  // Cloudinary cleanup — daily at 2:00 AM
  cron.schedule("0 2 * * *", async () => {
    console.log("[Cron] Starting Cloudinary FIFO cleanup...");
    const result = await cleanupOldPhotos();
    console.log("[Cron] Cloudinary cleanup completed:", result);
  });

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
    "[Cron] Scheduled jobs: Cloudinary cleanup (2AM), AMC generation (1st @ 1AM), AMC overdue check (8AM)",
  );
};
