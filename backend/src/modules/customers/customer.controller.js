import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import User from "../users/user.model.js";
import Customer from "./customer.model.js";
import Job from "../jobs/jobs.model.js";
import { sanitizeUser } from "../../utils/sanitizeUser.js";
import { hashPassword } from "../auth/auth.utils.js";

// ============================================
// ADMIN APIs: Customer Management
// ============================================

/**
 * Create Customer (Admin/SuperAdmin only)
 * Creates a User account + Customer profile
 */
export const createCustomer = asyncHandler(async (req, res) => {
  const isAdmin =
    req.user.userType === "admin" || req.user.userType === "superAdmin";

  if (!isAdmin) {
    throw new ApiError(403, "You do not have permission to create customers");
  }

  const {
    firstName,
    lastName,
    email,
    password,
    phoneNumber,
    customerName,
    customerPhone,
    bankName,
    atmIds,
    districtIds,
  } = req.body;

  // 1. Check if user already exists
  const existingUser = await User.findOne({
    $or: [{ email: email.toLowerCase() }, { phoneNumber }],
  });

  if (existingUser) {
    throw new ApiError(409, "User already exists with this email or phone");
  }

  // 2. Create User account (for auth)
  const hashedPassword = await hashPassword(password);

  const user = await User.create({
    firstName: firstName || customerName,
    lastName: lastName || "",
    email: email.toLowerCase(),
    password: hashedPassword,
    phoneNumber: customerPhone || phoneNumber,
    userType: "customer",
    status: "active",
  });

  // 3. Create Customer profile
  const customer = await Customer.create({
    userId: user._id,
    customerName: customerName || firstName,
    customerEmail: email.toLowerCase(),
    customerPhone: customerPhone || phoneNumber,
    bankName: bankName || "",
    atmIds: atmIds || [],
    districtIds: districtIds || [],
    createdBy: req.user._id,
  });

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        user: sanitizeUser(user),
        customer,
      },
      "Customer created successfully",
    ),
  );
});

/**
 * Get All Customers (Admin/SuperAdmin)
 */
export const getAllCustomers = asyncHandler(async (req, res) => {
  const isAdmin =
    req.user.userType === "admin" || req.user.userType === "superAdmin";

  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const customers = await Customer.find({ isDeleted: false })
    .populate("userId", "firstName lastName email phoneNumber status")
    .populate("atmIds", "atmId locationName bank")
    .populate("districtIds", "districtName")
    .sort({ createdAt: -1 });

  return res
    .status(200)
    .json(new ApiResponse(200, customers, "Customers fetched successfully"));
});

/**
 * Get Customer by ID
 */
export const getCustomerById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const customer = await Customer.findById(id)
    .populate("userId", "firstName lastName email phoneNumber status")
    .populate("atmIds", "atmId locationName bank address")
    .populate("districtIds", "districtName");

  if (!customer || customer.isDeleted) {
    throw new ApiError(404, "Customer not found");
  }

  // Customers can only view their own profile
  if (
    req.user.userType === "customer" &&
    customer.userId._id.toString() !== req.user._id.toString()
  ) {
    throw new ApiError(403, "You can only view your own profile");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, customer, "Customer fetched successfully"));
});

/**
 * Update Customer (Admin or self)
 */
export const updateCustomer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isAdmin =
    req.user.userType === "admin" || req.user.userType === "superAdmin";

  const customer = await Customer.findById(id);

  if (!customer || customer.isDeleted) {
    throw new ApiError(404, "Customer not found");
  }

  // Only admin or the customer themselves can update
  const isSelf = customer.userId.toString() === req.user._id.toString();

  if (!isAdmin && !isSelf) {
    throw new ApiError(
      403,
      "You do not have permission to update this customer",
    );
  }

  const allowedUpdates = isAdmin
    ? [
        "customerName",
        "customerPhone",
        "bankName",
        "atmIds",
        "districtIds",
        "isActive",
      ]
    : ["customerName", "customerPhone"]; // Customers can only update basic info

  const updates = {};
  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  updates.updatedBy = req.user._id;

  const updatedCustomer = await Customer.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  })
    .populate("userId", "firstName lastName email phoneNumber status")
    .populate("atmIds", "atmId locationName bank");

  return res
    .status(200)
    .json(
      new ApiResponse(200, updatedCustomer, "Customer updated successfully"),
    );
});

/**
 * Delete Customer (Soft Delete) - Admin only
 */
export const deleteCustomer = asyncHandler(async (req, res) => {
  const isAdmin =
    req.user.userType === "admin" || req.user.userType === "superAdmin";

  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const { id } = req.params;

  const customer = await Customer.findById(id);

  if (!customer || customer.isDeleted) {
    throw new ApiError(404, "Customer not found");
  }

  customer.isDeleted = true;
  customer.updatedBy = req.user._id;
  await customer.save();

  // Also deactivate the user account
  await User.findByIdAndUpdate(customer.userId, { status: "inactive" });

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Customer deleted successfully"));
});

// ============================================
// CUSTOMER PORTAL APIs
// ============================================

/**
 * Get Approved Jobs for Customer
 * Customers can ONLY see jobs that are APPROVED or CLOSED
 * And only for ATMs linked to this customer
 */
export const getCustomerJobs = asyncHandler(async (req, res) => {
  // This endpoint is called by the logged-in customer
  const customer = await Customer.findOne({
    userId: req.user._id,
    isDeleted: false,
  });

  if (!customer) {
    throw new ApiError(404, "Customer profile not found");
  }

  const { status, page = 1, limit = 10 } = req.query;

  // Build query: Only approved/closed jobs for customer's ATMs
  const query = {
    atmId: { $in: customer.atmIds },
    status: { $in: ["VERIFIED", "APPROVED", "CLOSED"] },
    isDeleted: false,
  };

  // Optional status filter
  if (status) {
    query.status = status;
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const jobs = await Job.find(query)
    .populate("atmId", "atmId locationName bank address districtId")
    .populate("assignedEmployeeId", "employeeCode")
    .populate("complaintId", "complaintNumber title")
    .sort({ approvedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Job.countDocuments(query);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        jobs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
      "Jobs fetched successfully",
    ),
  );
});

/**
 * Get Single Job Detail (Customer Portal)
 * Only if job is APPROVED/CLOSED and belongs to customer's ATM
 */
export const getCustomerJobDetail = asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  const customer = await Customer.findOne({
    userId: req.user._id,
    isDeleted: false,
  });

  if (!customer) {
    throw new ApiError(404, "Customer profile not found");
  }

  const job = await Job.findOne({
    _id: jobId,
    atmId: { $in: customer.atmIds },
    status: { $in: ["VERIFIED", "APPROVED", "CLOSED"] },
    isDeleted: false,
  })
    .populate("atmId", "atmId locationName bank address districtId regionId")
    .populate("assignedEmployeeId", "employeeCode userId")
    .populate("complaintId", "complaintNumber title description")
    .populate("beforePhotos", "url thumbnailUrl uploadedAt")
    .populate("afterPhotos", "url thumbnailUrl uploadedAt");

  if (!job) {
    throw new ApiError(404, "Job not found or not yet approved");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, job, "Job detail fetched successfully"));
});

/**
 * Get Job Photos (Customer Portal)
 */
export const getCustomerJobPhotos = asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  const customer = await Customer.findOne({
    userId: req.user._id,
    isDeleted: false,
  });

  if (!customer) {
    throw new ApiError(404, "Customer profile not found");
  }

  const job = await Job.findOne({
    _id: jobId,
    atmId: { $in: customer.atmIds },
    status: { $in: ["VERIFIED", "APPROVED", "CLOSED"] },
    isDeleted: false,
  }).populate("beforePhotos afterPhotos");

  if (!job) {
    throw new ApiError(404, "Job not found");
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        beforePhotos: job.beforePhotos || [],
        afterPhotos: job.afterPhotos || [],
      },
      "Photos fetched successfully",
    ),
  );
});
