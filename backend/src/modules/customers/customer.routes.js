import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";
import {
  addCustomerATMsSchema,
  createCustomerSchema,
  updateCustomerSchema,
} from "./customer.validation.js";
import {
  addCustomerATMs,
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  getCustomerJobs,
  getCustomerJobDetail,
  getCustomerJobPhotos,
  getCustomerPortalProfile,
  getCustomerPortalATMs,
  getCustomerPortalATMById,
  getCustomerPortalAMCs,
} from "./customer.controller.js";
import {
  exportCustomerAMCReport,
  exportCustomerJobReport,
  getCustomerReportSummary,
} from "./customerReports.controller.js";

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
  "/portal/profile",
  verifyAccessToken,
  authorizeRoles("customer"),
  getCustomerPortalProfile,
);

router.get(
  "/portal/atms",
  verifyAccessToken,
  authorizeRoles("customer"),
  getCustomerPortalATMs,
);

router.get(
  "/portal/atms/:atmId",
  verifyAccessToken,
  authorizeRoles("customer"),
  getCustomerPortalATMById,
);

router.get(
  "/portal/amcs",
  verifyAccessToken,
  authorizeRoles("customer"),
  getCustomerPortalAMCs,
);

router.get(
  "/portal/reports/summary",
  verifyAccessToken,
  authorizeRoles("customer"),
  getCustomerReportSummary,
);

router.get(
  "/portal/reports/jobs.xlsx",
  verifyAccessToken,
  authorizeRoles("customer"),
  exportCustomerJobReport,
);

router.get(
  "/portal/reports/amcs.xlsx",
  verifyAccessToken,
  authorizeRoles("customer"),
  exportCustomerAMCReport,
);

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

router.post(
  "/:id/atms",
  verifyAccessToken,
  authorizeRoles("admin", "superAdmin"),
  validateRequest(addCustomerATMsSchema),
  addCustomerATMs,
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
