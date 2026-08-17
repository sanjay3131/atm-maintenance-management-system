import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";

import {
  createComplaintSchema,
  updateComplaintSchema,
  linkJobSchema,
} from "./complaints.validation.js";

import {
  createComplaint,
  getAllComplaints,
  getComplaintById,
  updateComplaint,
  deleteComplaint,
  linkComplaintToJob,
  unlinkComplaintFromJob,
  getComplaintsByAtm,
  getComplaintsByCustomer,
  getComplaintStats,
} from "./complaints.controller.js";

const router = Router();

// ============================================
// COMPLAINT CRUD
// ============================================

// Create complaint
router.post(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(createComplaintSchema),
  createComplaint,
);

// Get all complaints (with filters, pagination, sorting)
router.get(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getAllComplaints,
);

// Get complaint statistics
router.get(
  "/stats",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getComplaintStats,
);

// Get complaints by ATM
router.get(
  "/atm/:atmId",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getComplaintsByAtm,
);

// Get complaints by Customer
router.get(
  "/customer/:customerId",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getComplaintsByCustomer,
);

// Get single complaint
router.get(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getComplaintById,
);

// Update complaint
router.put(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(updateComplaintSchema),
  updateComplaint,
);

// Delete complaint (soft delete)
router.delete(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  deleteComplaint,
);

// ============================================
// JOB LINKING
// ============================================

// Link complaint to job
router.put(
  "/:id/link-job",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(linkJobSchema),
  linkComplaintToJob,
);

// Unlink complaint from job
router.put(
  "/:id/unlink-job",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  unlinkComplaintFromJob,
);

export default router;
