import mongoose from "mongoose";
import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import User from "../users/user.model.js";
import Customer from "./customer.model.js";
import ATM from "../atms/atm.model.js";
import Bank from "../banks/bank.model.js";
import Job from "../jobs/jobs.model.js";
import { sanitizeUser } from "../../utils/sanitizeUser.js";
import { hashPassword } from "../auth/auth.utils.js";
import {
  buildATMGeographicQuery,
  escapeRegex,
  parsePagination,
} from "../../utils/geographicQuery.js";
import { softDeleteCustomerIfUnassigned } from "./customerAssignment.service.js";

const customerATMFields =
  "atmId locationName bankId districtId regionId address installationType status";

const populateCustomerATMs = (query) =>
  query.populate({
    path: "atmIds",
    select: customerATMFields,
    populate: [
      { path: "bankId", select: "bankName" },
      { path: "districtId", select: "districtName" },
      { path: "regionId", select: "name" },
    ],
  });

const validateCustomerId = (id) => {
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new ApiError(400, "Invalid customer ID");
  }
};

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
    atmIds: [],
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

  const {
    districtId,
    regionId,
    bankId,
    bankName,
    status,
    search,
    page,
    limit,
  } = req.query;
  const hasGeographicScope = Boolean(districtId || regionId);
  const isScoped =
    districtId !== undefined ||
    regionId !== undefined ||
    bankId !== undefined ||
    bankName !== undefined ||
    status !== undefined ||
    search !== undefined ||
    page !== undefined ||
    limit !== undefined;

  if (isScoped) {
    let atmQuery = { isDeleted: false };
    let customerBankNames;

    if (bankName !== undefined) {
      if (typeof bankName !== "string" || !bankName.trim()) {
        throw new ApiError(400, "Invalid bankName");
      }
      const selectedBank = await Bank.findOne({
        $or: [
          { bankCode: bankName.trim() },
          { bankName: bankName.trim() },
        ],
      }).select("bankCode bankName");
      customerBankNames = selectedBank
        ? [...new Set([selectedBank.bankCode, selectedBank.bankName])]
        : [bankName.trim()];
    } else if (bankId !== undefined && !hasGeographicScope) {
      if (!/^[0-9a-fA-F]{24}$/.test(bankId)) {
        throw new ApiError(400, "Invalid bankId");
      }
      const selectedBank = await Bank.findById(bankId).select(
        "bankCode bankName",
      );
      customerBankNames = selectedBank
        ? [...new Set([selectedBank.bankCode, selectedBank.bankName])]
        : [];
    }

    if (hasGeographicScope) {
      atmQuery = buildATMGeographicQuery({ districtId, regionId, bankId });
    }
    const pagination = parsePagination(page, limit);
    if (
      status !== undefined &&
      !["active", "inactive", "true", "false"].includes(status)
    ) {
      throw new ApiError(400, "Invalid status");
    }
    if (search !== undefined && typeof search !== "string") {
      throw new ApiError(400, "Invalid search");
    }

    const normalizedStatus =
      status === "active" || status === "true"
        ? true
        : status === "inactive" || status === "false"
          ? false
          : undefined;
    const normalizedSearch = search?.trim();
    const customerFilter = {
      ...(customerBankNames
        ? { bankName: { $in: customerBankNames } }
        : {}),
      ...(normalizedStatus === undefined
        ? {}
        : { isActive: normalizedStatus }),
      ...(normalizedSearch
        ? {
            $or: [
              {
                customerName: {
                  $regex: escapeRegex(normalizedSearch),
                  $options: "i",
                },
              },
              {
                customerEmail: {
                  $regex: escapeRegex(normalizedSearch),
                  $options: "i",
                },
              },
              {
                customerPhone: {
                  $regex: escapeRegex(normalizedSearch),
                  $options: "i",
                },
              },
            ],
          }
        : {}),
    };

    const [result] = await Customer.aggregate([
      {
        $match: {
          isDeleted: false,
          ...(customerBankNames
            ? { bankName: { $in: customerBankNames } }
            : {}),
        },
      },
      {
        $lookup: {
          from: ATM.collection.name,
          let: { customerId: "$_id" },
          pipeline: [
            {
              $match: {
                ...atmQuery,
                $expr: { $eq: ["$customer", "$$customerId"] },
              },
            },
            { $project: { _id: 1 } },
          ],
          as: "linkedATMs",
        },
      },
      {
        $addFields: {
          linkedATMCount: { $size: "$linkedATMs" },
        },
      },
      ...(hasGeographicScope
        ? [{ $match: { linkedATMCount: { $gt: 0 } } }]
        : []),
      {
        $facet: {
          total: [{ $count: "count" }],
          statusCounts: [{ $group: { _id: "$isActive", count: { $sum: 1 } } }],
          matchingCustomers: [
            { $match: customerFilter },
            { $sort: { createdAt: -1, _id: 1 } },
            { $skip: pagination.skip },
            { $limit: pagination.limit },
            {
              $lookup: {
                from: User.collection.name,
                localField: "userId",
                foreignField: "_id",
                pipeline: [
                  {
                    $project: {
                      firstName: 1,
                      lastName: 1,
                      email: 1,
                      phoneNumber: 1,
                      status: 1,
                      userType: 1,
                    },
                  },
                ],
                as: "user",
              },
            },
            {
              $lookup: {
                from: Bank.collection.name,
                let: { customerBankName: "$bankName" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $or: [
                          { $eq: ["$bankCode", "$$customerBankName"] },
                          { $eq: ["$bankName", "$$customerBankName"] },
                        ],
                      },
                    },
                  },
                  { $project: { bankName: 1 } },
                ],
                as: "bank",
              },
            },
            {
              $project: {
                _id: 1,
                userId: { $arrayElemAt: ["$user", 0] },
                customerName: 1,
                customerEmail: 1,
                customerPhone: 1,
                bankName: {
                  $ifNull: [
                    { $arrayElemAt: ["$bank.bankName", 0] },
                    "$bankName",
                  ],
                },
                isActive: 1,
                isDeleted: 1,
                createdAt: 1,
                updatedAt: 1,
                linkedATMCount: 1,
              },
            },
          ],
          matchingTotal: [{ $match: customerFilter }, { $count: "count" }],
        },
      },
    ]);

    const statusCounts = Object.fromEntries(
      (result?.statusCounts ?? []).map(({ _id, count }) => [
        _id ? "active" : "inactive",
        count,
      ]),
    );
    const matchingTotal = result?.matchingTotal?.[0]?.count ?? 0;
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          customers: result?.matchingCustomers ?? [],
          pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total: matchingTotal,
            totalPages: Math.ceil(matchingTotal / pagination.limit),
          },
          summary: {
            total: result?.total?.[0]?.count ?? 0,
            active: statusCounts.active ?? 0,
            inactive: statusCounts.inactive ?? 0,
          },
        },
        "Customers fetched successfully",
      ),
    );
  }

  const customers = await populateCustomerATMs(
    Customer.find({ isDeleted: false }).populate(
      "userId",
      "firstName lastName email phoneNumber status userType",
    ),
  )
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
  validateCustomerId(id);

  const customer = await Customer.findById(id).populate(
    "userId",
    "firstName lastName email phoneNumber status",
  );

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

  const [assignedATMs, bank] = await Promise.all([
    ATM.find({ customer: customer._id, isDeleted: false })
      .select(customerATMFields)
      .populate("bankId", "bankName")
      .populate("districtId", "districtName")
      .populate("regionId", "name"),
    customer.bankName
      ? Bank.findOne({
          $or: [
            { bankCode: customer.bankName },
            { bankName: customer.bankName },
          ],
        }).select("bankName")
      : null,
  ]);
  const customerData =
    typeof customer.toObject === "function" ? customer.toObject() : customer;
  const districts = new Map();
  assignedATMs.forEach((atm) => {
    const district = atm.districtId;
    if (district && typeof district === "object" && district._id) {
      districts.set(String(district._id), district);
    }
  });
  const customerResponse = {
    ...customerData,
    bankName: bank?.bankName ?? customer.bankName,
    atmIds: assignedATMs,
    linkedATMCount: assignedATMs.length,
    districtIds: [...districts.values()],
  };

  return res
    .status(200)
    .json(
      new ApiResponse(200, customerResponse, "Customer fetched successfully"),
    );
});

/**
 * Update Customer (Admin or self)
 */
export const updateCustomer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateCustomerId(id);
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

  if (Object.prototype.hasOwnProperty.call(req.body, "atmIds")) {
    throw new ApiError(
      400,
      "ATM assignments can only be changed through ATM management",
    );
  }

  const allowedUpdates = isAdmin
    ? [
        "customerName",
        "customerPhone",
        "bankName",
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

  const updatedCustomer = await populateCustomerATMs(
    Customer.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    }).populate("userId", "firstName lastName email phoneNumber status"),
  );

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
  validateCustomerId(id);

  await softDeleteCustomerIfUnassigned({
    customerId: id,
    updatedBy: req.user._id,
  });

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
