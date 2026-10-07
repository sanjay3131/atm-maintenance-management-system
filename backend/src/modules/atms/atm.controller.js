import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import Customer from "../customers/customer.model.js";
import District from "../districts/district.models.js";
import Employee from "../employees/employee.model.js";
import Region from "../region/region.model.js";
import AMC from "../amc/amc.model.js";
import { AMC_STATUS } from "../amc/amc.config.js";
import Job from "../jobs/jobs.model.js";
import { JOB_STATUS } from "../../utils/jobStatus.js";
import RecurringMaintenancePlan from "../jobs/recurringMaintenancePlan.model.js";
import {
  assignATMCustomerInTransaction,
  softDeleteATMAndUnlinkCustomer,
  withCustomerAssignmentTransaction,
} from "../customers/customerAssignment.service.js";
import {
  replaceATMEmployeeAssignmentInTransaction,
  setATMEmployeeAssignment,
} from "../employees/employeeAssignment.service.js";
import ATM from "./atm.model.js";
import { generateATMId } from "./atm.utils.js";
import {
  buildATMGeographicQuery,
  escapeRegex,
  parsePagination,
} from "../../utils/geographicQuery.js";

const validateActiveEmployee = async (employeeId) => {
  const employee = await Employee.findById(employeeId).populate(
    "userId",
    "userType status",
  );

  if (!employee) throw new ApiError(404, "Employee not found");
  if (
    employee.status !== "active" ||
    employee.userId?.status !== "active" ||
    employee.userId?.userType !== "employee"
  ) {
    throw new ApiError(400, "Employee is inactive");
  }

  return employee;
};

const validateActiveATMGeography = async (districtId, regionId) => {
  const district = await District.findById(districtId);
  if (!district) {
    throw new ApiError(404, "Destination district was not found");
  }
  if (!district.isActive) {
    throw new ApiError(400, "Destination district is inactive");
  }

  if (regionId == null) {
    const activeRegionCount = await Region.countDocuments({
      districtId,
      isActive: true,
    });
    if (activeRegionCount > 0) {
      throw new ApiError(
        400,
        "Select an active region because this district has active regions",
      );
    }
    return;
  }

  const region = await Region.findById(regionId);
  if (!region) {
    throw new ApiError(404, "Destination region was not found");
  }
  if (!region.isActive) {
    throw new ApiError(400, "Destination region is inactive");
  }
  if (region.districtId.toString() !== districtId.toString()) {
    throw new ApiError(
      400,
      "Destination region does not belong to the selected district",
    );
  }
};

const idOrNull = (value) => {
  if (value == null) return null;
  return (typeof value === "object" ? value._id : value).toString();
};

const ensureATMCanMove = async (atmId) => {
  const [unresolvedJobs, unresolvedAmcs, activePlans] = await Promise.all([
    Job.countDocuments({
      atmId,
      isDeleted: false,
      status: { $ne: JOB_STATUS.CLOSED },
    }),
    AMC.countDocuments({
      atmId,
      isDeleted: false,
      status: {
        $in: [
          AMC_STATUS.PENDING,
          AMC_STATUS.IN_PROGRESS,
          AMC_STATUS.OVERDUE,
        ],
      },
    }),
    RecurringMaintenancePlan.countDocuments({ atmId, isActive: true }),
  ]);

  const blockers = [];
  if (unresolvedJobs > 0) {
    blockers.push(`${unresolvedJobs} unresolved job(s)`);
  }
  if (unresolvedAmcs > 0) {
    blockers.push(`${unresolvedAmcs} unresolved AMC record(s)`);
  }
  if (activePlans > 0) {
    blockers.push(`${activePlans} active recurring maintenance plan(s)`);
  }

  if (blockers.length > 0) {
    throw new ApiError(
      409,
      `ATM cannot be moved while it has ${blockers.join(", ")}. Resolve these records or follow an approved procedure before moving it.`,
    );
  }
};

export const createATM = asyncHandler(async (req, res) => {
  const {
    bankId,
    districtId,
    regionId,
    locationName,
    address,
    installationType,
    location,
    customerId,
    status,
    assignedEmployeeId,
  } = req.body;
  const assignedEmployeeIds = [...new Set((assignedEmployeeId || []).map(String))];

  await validateActiveATMGeography(districtId, regionId);

  if (assignedEmployeeIds.length > 0) {
    if (assignedEmployeeIds.length > 1) {
      throw new ApiError(400, "An ATM can have only one assigned employee");
    }
    await validateActiveEmployee(assignedEmployeeIds[0]);
  }

  const resolvedCustomerId = customerId;
  const atmId = await generateATMId();

  const atmData = {
    atmId,
    bankId,
    customer: resolvedCustomerId,
    districtId,
    regionId,
    locationName,
    address,
    installationType,
    location,
    status,
    assignedEmployeeId: [],
    createdBy: req.user._id,
  };
  const atm = await withCustomerAssignmentTransaction(async (session) => {
    const [createdATM] = await ATM.create([atmData], { session });
    await assignATMCustomerInTransaction({
      atm: createdATM,
      atmId: createdATM._id,
      customerId: resolvedCustomerId,
      updatedBy: req.user._id,
      session,
    });

    if (assignedEmployeeIds.length > 0) {
      return replaceATMEmployeeAssignmentInTransaction({
        atmId: createdATM._id,
        employeeId: assignedEmployeeIds[0],
        updatedBy: req.user._id,
        session,
      });
    }
    return createdATM;
  });

  return res
    .status(201)
    .json(new ApiResponse(201, atm, "ATM created successfully"));
});

// view all atm
export const getAllATMs = asyncHandler(async (req, res) => {
  const { districtId, regionId, bankId, status, search } = req.query;
  const isScoped =
    districtId !== undefined ||
    regionId !== undefined ||
    bankId !== undefined ||
    req.query.page !== undefined ||
    req.query.limit !== undefined ||
    status !== undefined ||
    search !== undefined;

  if (isScoped) {
    const scope = buildATMGeographicQuery({ districtId, regionId, bankId });
    const { page, limit, skip } = parsePagination(req.query.page, req.query.limit);
    if (
      status !== undefined &&
      !["ACTIVE", "INACTIVE", "UNDER_MAINTENANCE", "REMOVED"].includes(status)
    ) {
      throw new ApiError(400, "Invalid status");
    }
    if (search !== undefined && typeof search !== "string") {
      throw new ApiError(400, "Invalid search");
    }

    const query = {
      ...scope,
      ...(status ? { status } : {}),
      ...(search?.trim()
        ? {
            $or: [
              { atmId: { $regex: escapeRegex(search.trim()), $options: "i" } },
              {
                locationName: {
                  $regex: escapeRegex(search.trim()),
                  $options: "i",
                },
              },
              {
                address: {
                  $regex: escapeRegex(search.trim()),
                  $options: "i",
                },
              },
            ],
          }
        : {}),
    };

    const [atms, aggregate] = await Promise.all([
      ATM.find(query)
        .populate("bankId", "bankName")
        .populate("districtId", "districtName")
        .populate("regionId", "name")
        .populate({
          path: "assignedEmployeeId",
          select: "employeeCode userId",
          populate: { path: "userId", select: "firstName lastName status" },
        })
        .populate("customer", "customerName")
        .sort({ atmId: 1, _id: 1 })
        .skip(skip)
        .limit(limit),
      ATM.aggregate([
        { $match: query },
        {
          $facet: {
            total: [{ $count: "count" }],
            statusCounts: [
              { $group: { _id: "$status", count: { $sum: 1 } } },
            ],
            linkedCustomers: [
              { $match: { customer: { $ne: null } } },
              { $group: { _id: "$customer" } },
              {
                $lookup: {
                  from: Customer.collection.name,
                  let: { customerId: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$_id", "$$customerId"] },
                        isDeleted: false,
                      },
                    },
                  ],
                  as: "customer",
                },
              },
              { $match: { "customer.0": { $exists: true } } },
              { $count: "count" },
            ],
            linkedEmployees: [
              { $unwind: "$assignedEmployeeId" },
              { $match: { assignedEmployeeId: { $ne: null } } },
              { $group: { _id: "$assignedEmployeeId" } },
              {
                $lookup: {
                  from: Employee.collection.name,
                  localField: "_id",
                  foreignField: "_id",
                  as: "employee",
                },
              },
              { $match: { "employee.0": { $exists: true } } },
              { $count: "count" },
            ],
          },
        },
      ]),
    ]);

    const summary = aggregate[0] ?? {};
    const total = summary.total?.[0]?.count ?? 0;
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          atms,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
          summary: {
            total,
            statusCounts: Object.fromEntries(
              (summary.statusCounts ?? []).map(({ _id, count }) => [_id, count]),
            ),
            linkedCustomers: summary.linkedCustomers?.[0]?.count ?? 0,
            linkedEmployees: summary.linkedEmployees?.[0]?.count ?? 0,
          },
        },
        "ATMs fetched successfully",
      ),
    );
  }

  const atms = await ATM.find({ isDeleted: false })
    .populate("bankId", "bankName")
    .populate("districtId", "districtName")
    .populate("regionId", "name")
    .populate({
      path: "assignedEmployeeId",
      select: "employeeCode userId",
      populate: { path: "userId", select: "firstName lastName status" },
    })
    .populate("customer", "customerName");

  return res
    .status(200)
    .json(new ApiResponse(200, atms, "ATMs fetched successfully"));
});

// view single atm

export const getATMById = asyncHandler(async (req, res) => {
  const atm = await ATM.findById(req.params.id)
    .populate("bankId", "bankName")
    .populate("districtId", "districtName")
    .populate("regionId", "name")
    .populate("customer", "customerName")
    .populate({
      path: "assignedEmployeeId",
      select: "employeeCode userId",
      populate: {
        path: "userId",
        select: "firstName lastName phoneNumber email",
      },
    });
  if (!atm || atm.isDeleted) {
    throw new ApiError(404, "ATM not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, atm, "ATM fetched successfully"));
});

// update atm
export const updateATM = asyncHandler(async (req, res) => {
  const updatePayload = { ...req.body };
  const atm = await ATM.findById(req.params.id);

  if (!atm || atm.isDeleted) {
    throw new ApiError(404, "ATM not found");
  }

  const hasDistrictUpdate = Object.prototype.hasOwnProperty.call(
    updatePayload,
    "districtId",
  );
  const hasRegionUpdate = Object.prototype.hasOwnProperty.call(
    updatePayload,
    "regionId",
  );
  const hasGeographyUpdate = hasDistrictUpdate || hasRegionUpdate;
  const districtChanged =
    hasDistrictUpdate &&
    idOrNull(updatePayload.districtId) !== idOrNull(atm.districtId);
  let geographyChanged = false;

  if (hasGeographyUpdate) {
    const destinationDistrictId = hasDistrictUpdate
      ? updatePayload.districtId
      : atm.districtId;
    const destinationRegionId = hasRegionUpdate
      ? updatePayload.regionId
      : districtChanged
        ? null
        : atm.regionId;

    await validateActiveATMGeography(
      destinationDistrictId,
      destinationRegionId,
    );

    geographyChanged =
      idOrNull(destinationDistrictId) !== idOrNull(atm.districtId) ||
      idOrNull(destinationRegionId) !== idOrNull(atm.regionId);

    if (districtChanged && !hasRegionUpdate) {
      updatePayload.regionId = destinationRegionId;
    }

    if (geographyChanged) {
      await ensureATMCanMove(atm._id);
    }
  }

  let assignedEmployeeIds;
  if (
    Object.prototype.hasOwnProperty.call(updatePayload, "assignedEmployeeId")
  ) {
    assignedEmployeeIds = [
      ...new Set((updatePayload.assignedEmployeeId || []).map(String)),
    ];

    if (assignedEmployeeIds.length > 0) {
      if (assignedEmployeeIds.length > 1) {
        throw new ApiError(400, "An ATM can have only one assigned employee");
      }
      await validateActiveEmployee(assignedEmployeeIds[0]);
    }

    delete updatePayload.assignedEmployeeId;
  }

  const hasCustomerUpdate = Object.prototype.hasOwnProperty.call(
    updatePayload,
    "customerId",
  );
  const customerId = updatePayload.customerId;
  if (hasCustomerUpdate) {
    delete updatePayload.customerId;
  }

  let updatedATM;
  if (hasCustomerUpdate) {
    updatedATM = await withCustomerAssignmentTransaction(async (session) => {
      const currentATM = await ATM.findOne({
        _id: req.params.id,
        isDeleted: false,
      }).session(session);
      if (!currentATM) throw new ApiError(404, "ATM not found");
      Object.assign(currentATM, updatePayload);
      currentATM.updatedBy = req.user._id;
      return assignATMCustomerInTransaction({
        atm: currentATM,
        atmId: currentATM._id,
        customerId,
        updatedBy: req.user._id,
        session,
      });
    });
  } else {
    updatedATM = await ATM.findByIdAndUpdate(
      req.params.id,
      {
        ...updatePayload,
        updatedBy: req.user._id,
      },
      {
        new: true,
        runValidators: true,
      },
    );
  }

  if (!updatedATM || updatedATM.isDeleted) {
    throw new ApiError(404, "ATM not found");
  }

  if (assignedEmployeeIds !== undefined) {
    updatedATM = await setATMEmployeeAssignment({
      atmId: updatedATM._id,
      employeeId: assignedEmployeeIds[0] || null,
      updatedBy: req.user._id,
    });
  }

  return res
    .status(200)
    .json(new ApiResponse(200, updatedATM, "ATM updated successfully"));
});

// delete atm (soft delete)
export const deleteATM = asyncHandler(async (req, res) => {
  const atm = await softDeleteATMAndUnlinkCustomer({
    atmId: req.params.id,
    updatedBy: req.user._id,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, atm, "ATM deleted successfully"));
});

// assign employee to atm
export const assignEmployeeToATM = asyncHandler(async (req, res) => {
  const { employeeId } = req.body;
  const atmId = req.params.id;

  if (!/^[a-fA-F0-9]{24}$/.test(atmId)) {
    throw new ApiError(400, "Invalid ATM ID");
  }

  const atm = await setATMEmployeeAssignment({
    atmId,
    employeeId,
    updatedBy: req.user._id,
  });

  return res
    .status(200)
    .json(
      new ApiResponse(200, atm, "ATM employee assignment updated successfully"),
    );
});

// ============================================
// SET ATM LOCATION (Employee)
// ============================================
export const setATMLocation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { latitude, longitude, accuracy } = req.body;

  if (req.user.userType !== "employee") {
    throw new ApiError(403, "Only employees can set ATM location");
  }

  const atm = await ATM.findById(id);
  if (!atm || atm.isDeleted) throw new ApiError(404, "ATM not found");

  // Verify employee is assigned to this ATM
  const employee = await Employee.findOne({ userId: req.user._id });
  if (!employee) throw new ApiError(404, "Employee not found");

  const atmEmployeeIds = (atm.assignedEmployeeId || []).map((employeeId) =>
    employeeId.toString(),
  );
  if (!atmEmployeeIds.includes(employee._id.toString())) {
    throw new ApiError(403, "You are not assigned to this ATM");
  }

  // If already configured, block (admin can override via updateATM)
  if (atm.locationConfigured) {
    throw new ApiError(
      400,
      "ATM location already configured. Contact admin to reset.",
    );
  }

  // Validate coordinates
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    throw new ApiError(400, "Invalid coordinates");
  }

  if (accuracy && accuracy > 50) {
    throw new ApiError(
      400,
      "GPS accuracy is too low. Please move to an open area and try again.",
    );
  }

  atm.location = {
    type: "Point",
    coordinates: [longitude, latitude],
  };
  atm.locationConfigured = true;
  atm.locationCapturedAt = new Date();
  atm.locationCapturedBy = req.user._id;
  atm.locationAccuracy = accuracy || null;
  atm.updatedBy = req.user._id;

  await atm.save();

  return res
    .status(200)
    .json(new ApiResponse(200, atm, "ATM location configured successfully"));
});

// ============================================
// GET ATM LOCATION STATUS (Admin)
// ============================================
export const getATMLocationStatus = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Access denied");

  const { configured, page = 1, limit = 20 } = req.query;

  const query = { isDeleted: false };
  if (configured !== undefined) {
    query.locationConfigured = configured === "true";
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [atms, total] = await Promise.all([
    ATM.find(query)
      .populate("districtId", "districtName")
      .populate("bankId", "bankName")
      .populate("locationCapturedBy", "firstName lastName")
      .populate("assignedEmployeeId", "employeeCode firstName lastName")
      .sort({ locationConfigured: 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    ATM.countDocuments(query),
  ]);

  const stats = {
    total: await ATM.countDocuments({ isDeleted: false }),
    configured: await ATM.countDocuments({
      isDeleted: false,
      locationConfigured: true,
    }),
    notConfigured: await ATM.countDocuments({
      isDeleted: false,
      locationConfigured: false,
    }),
  };

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        atms,
        stats,
        pagination: { page: parseInt(page), limit: parseInt(limit), total },
      },
      "ATM location status fetched",
    ),
  );
});
