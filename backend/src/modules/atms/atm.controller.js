import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import Customer from "../customers/customer.model.js";
import District from "../districts/district.models.js";
import Employee from "../employees/employee.model.js";
import Region from "../region/region.model.js";
import AMC from "../amc/amc.model.js";
import { AMC_STATUS } from "../amc/amc.config.js";
import { setATMAMCResponsibleEmployee } from "../amc/amcResponsibility.service.js";
import Job from "../jobs/jobs.model.js";
import { JOB_STATUS } from "../../utils/jobStatus.js";
import RecurringMaintenancePlan from "../jobs/recurringMaintenancePlan.model.js";
import {
  assignATMCustomerInTransaction,
  softDeleteATMAndUnlinkCustomer,
  withCustomerAssignmentTransaction,
} from "../customers/customerAssignment.service.js";
import {
  replaceATMEmployeeAssignmentsInTransaction,
  replaceATMEmployeeAssignments,
  setATMEmployeeAssignment,
} from "../employees/employeeAssignment.service.js";
import ATM from "./atm.model.js";
import {
  approveATMlocationRequest,
  getATMlocationRequest,
  listATMlocationRequests,
  rejectATMlocationRequest,
  reopenATMlocationRequests,
  submitATMlocationRequest,
} from "./atmLocationRequest.service.js";
import {
  cancelATMLocationTask as cancelLocationTask,
  createBulkATMLocationTasks,
  holdATMLocationTask as holdLocationTask,
  listATMLocationTasks as listLocationTasks,
  listMyATMLocationTasks,
  reassignATMLocationTask as reassignLocationTask,
  reopenRejectedATMLocationTask,
  resumeATMLocationTask as resumeLocationTask,
  startATMLocationTask as startLocationTask,
} from "./atmLocationTask.service.js";
import { generateATMId } from "./atm.utils.js";
import {
  buildATMGeographicQuery,
  escapeRegex,
  parsePagination,
} from "../../utils/geographicQuery.js";

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
      status: { $nin: [JOB_STATUS.CLOSED, JOB_STATUS.CANCELLED] },
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
  if (Object.prototype.hasOwnProperty.call(req.body, "location")) {
    throw new ApiError(
      400,
      "Initial ATM coordinates must be submitted through the location request workflow",
    );
  }

  const {
    bankId,
    districtId,
    regionId,
    locationName,
    address,
    installationType,
    customerId,
    status,
    assignedEmployeeId,
  } = req.body;
  const assignedEmployeeIds = [
    ...new Set((assignedEmployeeId || []).map((id) => String(id).toLowerCase())),
  ];

  await validateActiveATMGeography(districtId, regionId);

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
      return replaceATMEmployeeAssignmentsInTransaction({
        atmId: createdATM._id,
        employeeIds: assignedEmployeeIds,
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
        .populate({
          path: "amcResponsibleEmployeeId",
          select: "employeeCode status userId",
          populate: { path: "userId", select: "firstName lastName status userType" },
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
    .populate({
      path: "amcResponsibleEmployeeId",
      select: "employeeCode status userId",
      populate: { path: "userId", select: "firstName lastName status userType" },
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
  await atm.populate({
    path: "amcResponsibleEmployeeId",
    select: "employeeCode status userId",
    populate: {
      path: "userId",
      select: "firstName lastName phoneNumber email status userType",
    },
  });
  return res
    .status(200)
    .json(new ApiResponse(200, atm, "ATM fetched successfully"));
});

// update atm
export const updateATM = asyncHandler(async (req, res) => {
  if (Object.prototype.hasOwnProperty.call(req.body, "location")) {
    throw new ApiError(
      400,
      "ATM coordinates must be changed through the location request workflow",
    );
  }

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
      ...new Set(
        (updatePayload.assignedEmployeeId || []).map((id) =>
          String(id).toLowerCase(),
        ),
      ),
    ];

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
    updatedATM = await replaceATMEmployeeAssignments({
      atmId: updatedATM._id,
      employeeIds: assignedEmployeeIds,
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

export const setATMAMCResponsible = asyncHandler(async (req, res) => {
  const { employeeId } = req.body;
  const atmId = req.params.id;

  if (!/^[a-fA-F0-9]{24}$/.test(atmId)) {
    throw new ApiError(400, "Invalid ATM ID");
  }

  const atm = await setATMAMCResponsibleEmployee({
    atmId,
    employeeId,
    updatedBy: req.user._id,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, atm, "AMC responsible employee updated"));
});

// Kept temporarily for older clients; this endpoint must not write official coordinates.
export const setATMLocation = asyncHandler(async () => {
  throw new ApiError(
    410,
    "Direct ATM location updates are no longer supported. Submit a location request for Admin or SuperAdmin review.",
  );
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

export const submitATMLocationRequest = asyncHandler(async (req, res) => {
  const request = await submitATMlocationRequest({
    ...req.body,
    requester: req.user,
  });
  return res
    .status(201)
    .json(new ApiResponse(201, request, "ATM location request submitted"));
});

export const listATMLocationRequests = asyncHandler(async (req, res) => {
  const result = await listATMlocationRequests({
    ...req.validatedQuery,
    ...(req.user.userType === "employee"
      ? { requesterId: req.user._id }
      : {}),
  });
  return res
    .status(200)
    .json(new ApiResponse(200, result, "ATM location requests fetched"));
});

export const getATMLocationRequest = asyncHandler(async (req, res) => {
  const request = await getATMlocationRequest(req.validatedParams.requestId);
  return res
    .status(200)
    .json(new ApiResponse(200, request, "ATM location request fetched"));
});

export const approveATMLocationRequest = asyncHandler(async (req, res) => {
  const request = await approveATMlocationRequest({
    requestId: req.validatedParams.requestId,
    reviewerId: req.user._id,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, request, "ATM location request approved"));
});

export const rejectATMLocationRequest = asyncHandler(async (req, res) => {
  const request = await rejectATMlocationRequest({
    requestId: req.validatedParams.requestId,
    reviewerId: req.user._id,
    reason: req.body.reason,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, request, "ATM location request rejected"));
});

export const reopenATMLocationRequests = asyncHandler(async (req, res) => {
  const result = await reopenATMlocationRequests({
    atmId: req.validatedParams.id,
    reviewerId: req.user._id,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, result, "ATM location requests reopened"));
});

export const createATMLocationTasks = asyncHandler(async (req, res) => {
  const tasks = await createBulkATMLocationTasks({
    tasks: req.body.tasks,
    adminId: req.user._id,
  });
  return res
    .status(201)
    .json(new ApiResponse(201, { tasks }, "ATM location tasks created"));
});

export const getATMLocationTasks = asyncHandler(async (req, res) => {
  const result =
    req.user.userType === "employee"
      ? await listMyATMLocationTasks({
          ...req.validatedQuery,
          userId: req.user._id,
        })
      : await listLocationTasks(req.validatedQuery);
  return res
    .status(200)
    .json(new ApiResponse(200, result, "ATM location tasks fetched"));
});

export const startATMLocationTask = asyncHandler(async (req, res) => {
  const task = await startLocationTask({
    taskId: req.validatedParams.taskId,
    employeeUserId: req.user._id,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, task, "ATM location task started"));
});

export const holdATMLocationTask = asyncHandler(async (req, res) => {
  const task = await holdLocationTask({
    taskId: req.validatedParams.taskId,
    employeeUserId: req.user._id,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, task, "ATM location task put on hold"));
});

export const resumeATMLocationTask = asyncHandler(async (req, res) => {
  const task = await resumeLocationTask({
    taskId: req.validatedParams.taskId,
    employeeUserId: req.user._id,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, task, "ATM location task resumed"));
});

export const reassignATMLocationTask = asyncHandler(async (req, res) => {
  const task = await reassignLocationTask({
    taskId: req.validatedParams.taskId,
    employeeId: req.body.employeeId,
    adminId: req.user._id,
    reason: req.body.reason,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, task, "ATM location task reassigned"));
});

export const reopenATMLocationTask = asyncHandler(async (req, res) => {
  const task = await reopenRejectedATMLocationTask({
    taskId: req.validatedParams.taskId,
    employeeId: req.body.employeeId,
    adminId: req.user._id,
    reason: req.body.reason,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, task, "Rejected ATM location task reopened"));
});

export const cancelATMLocationTask = asyncHandler(async (req, res) => {
  const task = await cancelLocationTask({
    taskId: req.validatedParams.taskId,
    adminId: req.user._id,
    reason: req.body.reason,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, task, "ATM location task cancelled"));
});
