import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import {
  getDashboardStats,
  getRecentActivity,
  getEmployeePerformance,
  getDistrictSummary,
  getBankSummary,
  getJobTrends,
} from "./dashboard.controller.js";

const router = Router();

// Main dashboard stats — everything in one call
router.get(
  "/stats",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getDashboardStats,
);

// Recent activity feed
router.get(
  "/recent-activity",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getRecentActivity,
);

// Employee performance leaderboard
router.get(
  "/employee-performance",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getEmployeePerformance,
);

// District summary (ATM counts per district)
router.get(
  "/district-summary",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getDistrictSummary,
);

// Bank summary (ATM counts per bank)
router.get(
  "/bank-summary",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getBankSummary,
);

// Job trends (daily/weekly counts for charts)
router.get(
  "/job-trends",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getJobTrends,
);

export default router;
