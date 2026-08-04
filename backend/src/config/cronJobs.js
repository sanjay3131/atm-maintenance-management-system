import cron from "node-cron";
import { cleanupOldPhotos } from "./cloudinaryCleanup.js";

/**
 * Initialize all cron jobs
 * Call this in server.js after DB connection
 */
export const initCronJobs = () => {
  // Run Cloudinary cleanup every day at 2:00 AM
  cron.schedule("0 2 * * *", async () => {
    console.log("[Cron] Starting Cloudinary FIFO cleanup...");
    const result = await cleanupOldPhotos();
    console.log("[Cron] Cloudinary cleanup completed:", result);
  });

  console.log("[Cron] Scheduled daily Cloudinary FIFO cleanup at 2:00 AM");
};
