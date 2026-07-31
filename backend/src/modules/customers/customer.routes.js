import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  getCustomerJobs,
  getCustomerJobDetail,
  getCustomerJobPhotos,
} from "./customer.controller.js";

const router = Router();

// ============================================
// ADMIN ROUTES
// ============================================

router.post(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  createCustomer,
);

router.get(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getAllCustomers,
);

router.get(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "customer"),
  getCustomerById,
);

router.put(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin", "customer"),
  updateCustomer,
);

router.delete(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  deleteCustomer,
);

// ============================================
// CUSTOMER PORTAL ROUTES
// ============================================

// These are accessed by customers (userType: "customer")
router.get(
  "/portal/jobs",
  verifyAccessToken,
  authorizeRoles("customer"),
  getCustomerJobs,
);

router.get(
  "/portal/jobs/:jobId",
  verifyAccessToken,
  authorizeRoles("customer"),
  getCustomerJobDetail,
);

router.get(
  "/portal/jobs/:jobId/photos",
  verifyAccessToken,
  authorizeRoles("customer"),
  getCustomerJobPhotos,
);

export default router;
