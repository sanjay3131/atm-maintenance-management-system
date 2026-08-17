import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import {
  createComplaint,
  getAllComplaints,
  getComplaintById,
  updateComplaint,
  deleteComplaint,
  linkComplaintToJob,
  getComplaintsByAtm,
  getComplaintStats,
} from "./complaints.controller.js";

const router = Router();

router.post(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  createComplaint,
);
router.get(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getAllComplaints,
);
router.get(
  "/stats",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getComplaintStats,
);
router.get(
  "/atm/:atmId",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getComplaintsByAtm,
);
router.get(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getComplaintById,
);
router.put(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  updateComplaint,
);
router.delete(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  deleteComplaint,
);
router.put(
  "/:id/link-job",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  linkComplaintToJob,
);

export default router;
