import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";
import {
  createCustomerSchema,
  updateCustomerSchema,
} from "./customer.validation.js";
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
  validateRequest(createCustomerSchema),
  createCustomer,
);

router.get(
  "/",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  getAllCustomers,
);

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

// ============================================
// CUSTOMER DETAIL AND MUTATION ROUTES
// ============================================

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
  validateRequest(updateCustomerSchema),
  updateCustomer,
);

router.delete(
  "/:id",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  deleteCustomer,
);

export default router;
