import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import Customer from "../customers/customer.model.js";
import District from "../districts/district.models.js";
import Employee from "../employees/employee.model.js";
import Region from "../region/region.model.js";
import Bank from "../banks/bank.model.js";
import AMC from "../amc/amc.model.js";
import { AMC_STATUS } from "../amc/amc.config.js";
import { setATMAMCResponsibleEmployee } from "../amc/amcResponsibility.service.js";
import Job from "../jobs/jobs.model.js";
import { JOB_STATUS } from "../../utils/jobStatus.js";
import RecurringMaintenancePlan from "../jobs/recurringMaintenancePlan.model.js";
import { withDistrictGeographyFence } from "../districts/districtGeography.service.js";
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
import { reserveATMIds } from "./atm.utils.js";
import { createATMUploadTemplateWorkbook } from "./atmBulkUploadTemplate.service.js";
import {
  buildATMGeographicQuery,
  escapeRegex,
  parsePagination,
} from "../../utils/geographicQuery.js";
import { publishDomainEventSafely } from "../../realtime/domain-events.js";
import {
  resolveATMRecipients,
  resolveLocationRequestRecipients,
  resolveLocationTaskRecipients,
} from "../../realtime/recipient-resolver.js";

const isClientAtmIdDuplicate = (error) =>
  error?.code === 11000 &&
  (error.keyPattern?.clientAtmId ||
    error.keyValue?.clientAtmId ||
    `${error.index ?? ""} ${error.message ?? ""}`.includes(
      "uniq_atm_client_atm_id",
    ));

const throwClientAtmIdDuplicateError = (error) => {
  if (!isClientAtmIdDuplicate(error)) throw error;
  throw new ApiError(409, "Client ATM ID already exists");
};

export const publishLocationRequestUpdated = async (
  request,
  action,
  {
    publishEvent = publishDomainEventSafely,
    linkedTask,
  } = {},
) => {
  await publishEvent({
    event: "domain:atm-location-request:updated",
    entityType: "atm-location-request",
    entityId: request._id,
    action,
    data: { atmId: String(request.atmId) },
    resolveRecipients: () => resolveLocationRequestRecipients(request),
  });

  if (!request.locationTaskId) return;
  if (!linkedTask || String(linkedTask._id) !== String(request.locationTaskId)) {
    console.error(
      `Realtime task event skipped: committed task result missing for location request ${request._id}`,
    );
    return;
  }

  await publishEvent({
    event: "domain:atm-location-task:updated",
    entityType: "atm-location-task",
    entityId: linkedTask._id,
    action: action === "approved" ? "completed" : "rejected",
    data: {
      atmId: String(linkedTask.atmId),
      locationRequestId: String(request._id),
    },
    resolveRecipients: () => resolveLocationTaskRecipients(linkedTask),
  });
};

export const publishATMRequestsReopened = async (
  atmId,
  {
    publishEvent = publishDomainEventSafely,
    findATM = (id) => ATM.findById(id).select("assignedEmployeeId"),
  } = {},
) => {
  let atm;
  try {
    atm = await findATM(atmId);
  } catch (error) {
    console.error(
      `Realtime recipient lookup failed for reopened ATM ${atmId}:`,
      error.message,
    );
    return;
  }
  if (!atm) return;

  await publishEvent({
    event: "domain:atm-location-request:updated",
    entityType: "atm-location",
    entityId: atmId,
    action: "requests-reopened",
    data: { atmId: String(atmId) },
    resolveRecipients: () => resolveATMRecipients(atm),
  });
};

export const validateActiveATMGeography = async (
  bankId,
  districtId,
  regionId,
  session,
) => {
  const bankQuery = Bank.findById(bankId).select("_id isActive");
  if (session) bankQuery.session(session);
  const bank = await bankQuery;
  if (!bank) throw new ApiError(404, "Selected bank was not found");
  if (!bank.isActive) throw new ApiError(400, "Selected bank is inactive");
  const districtQuery = District.findById(districtId).select(
    "_id bankId regionId geographyStatus isActive",
  );
  if (session) districtQuery.session(session);
  const district = await districtQuery;
  if (!district) {
    throw new ApiError(404, "Destination district was not found");
  }
  if (!district.isActive) {
    throw new ApiError(400, "Destination district is inactive");
  }
  if (district.geographyStatus !== "MAPPED") {
    throw new ApiError(400, "Destination district is not mapped");
  }

  const regionQuery = Region.findById(regionId).select(
    "_id bankId isActive geographyStatus",
  );
  if (session) regionQuery.session(session);
  const region = await regionQuery;
  if (!region) {
    throw new ApiError(404, "Destination region was not found");
  }
  if (!region.isActive) {
    throw new ApiError(400, "Destination region is inactive");
  }
  if (region.geographyStatus !== "MAPPED") {
    throw new ApiError(400, "Destination region is not mapped");
  }
  if (String(region.bankId) !== String(bankId)) {
    throw new ApiError(
      400,
      "Selected region does not belong to the selected bank",
    );
  }
  if (String(district.regionId) !== String(regionId)) {
    throw new ApiError(400, "Selected district does not belong to the selected region");
  }
  if (
    String(district.bankId) !== String(bankId) ||
    String(district.bankId) !== String(region.bankId)
  ) {
    throw new ApiError(
      400,
      "Selected district does not belong to the selected bank",
    );
  }
};

const idOrNull = (value) => {
  if (value == null) return null;
  return (typeof value === "object" ? value._id : value).toString();
};

const ensureATMCanMove = async (atmId, session) => {
  const unresolvedJobsQuery = Job.countDocuments({
    atmId,
    isDeleted: false,
    status: { $nin: [JOB_STATUS.CLOSED, JOB_STATUS.CANCELLED] },
  });
  const unresolvedAmcsQuery = AMC.countDocuments({
    atmId,
    isDeleted: false,
    status: {
      $in: [AMC_STATUS.PENDING, AMC_STATUS.IN_PROGRESS, AMC_STATUS.OVERDUE],
    },
  });
  const activePlansQuery = RecurringMaintenancePlan.countDocuments({
    atmId,
    isActive: true,
  });
  if (session) {
    unresolvedJobsQuery.session(session);
    unresolvedAmcsQuery.session(session);
    activePlansQuery.session(session);
  }
  const unresolvedJobs = await unresolvedJobsQuery;
  const unresolvedAmcs = await unresolvedAmcsQuery;
  const activePlans = await activePlansQuery;

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

export const downloadATMUploadTemplate = asyncHandler(async (_req, res) => {
  const result = await createATMUploadTemplateWorkbook();
  return res
    .status(200)
    .set("Content-Type", result.contentType)
    .set("Content-Disposition", `attachment; filename="${result.filename}"`)
    .set("Cache-Control", "private, no-store")
    .set("X-Content-Type-Options", "nosniff")
    .send(result.buffer);
});

export const createATM = asyncHandler(async (req, res) => {
  if (Object.prototype.hasOwnProperty.call(req.body, "location")) {
    throw new ApiError(
      400,
      "Initial ATM coordinates must be submitted through the location request workflow",
    );
  }

  const {
    bankId,
    clientAtmId,
    districtId,
    regionId,
    locationName,
    city,
    address,
    installationType,
    customerId,
    status,
    assignedEmployeeId,
  } = req.body;
  const assignedEmployeeIds = [
    ...new Set((assignedEmployeeId || []).map((id) => String(id).toLowerCase())),
  ];

  const resolvedCustomerId = customerId;
  const atmData = {
    clientAtmId,
    bankId,
    geographyStatus: "MAPPED",
    customer: resolvedCustomerId,
    districtId,
    regionId,
    locationName,
    city,
    address,
    installationType,
    status,
    assignedEmployeeId: [],
    createdBy: req.user._id,
  };
  const atm = await withDistrictGeographyFence([districtId], async (session) => {
    await validateActiveATMGeography(bankId, districtId, regionId, session);
    const [atmId] = await reserveATMIds(1, { session });
    const [createdATM] = await ATM.create([{ ...atmData, atmId }], { session });
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
  }).catch(throwClientAtmIdDuplicateError);

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
            {
              clientAtmId: {
                $regex: escapeRegex(search.trim()),
                $options: "i",
              },
            },
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
        select: "firstName lastName phoneNumber email avatar",
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

  const hasBankUpdate = Object.prototype.hasOwnProperty.call(
    updatePayload,
    "bankId",
  );
  const hasDistrictUpdate = Object.prototype.hasOwnProperty.call(
    updatePayload,
    "districtId",
  );
  const hasRegionUpdate = Object.prototype.hasOwnProperty.call(
    updatePayload,
    "regionId",
  );
  const hasGeographyUpdate = hasBankUpdate || hasDistrictUpdate || hasRegionUpdate;
  const destinationBankId = hasBankUpdate ? updatePayload.bankId : atm.bankId;
  let geographyChanged = hasBankUpdate &&
    idOrNull(updatePayload.bankId) !== idOrNull(atm.bankId);

  if (hasGeographyUpdate) {
    const destinationDistrictId = hasDistrictUpdate
      ? updatePayload.districtId
      : atm.districtId;
    const destinationRegionId = hasRegionUpdate
      ? updatePayload.regionId
      : atm.regionId;

    await validateActiveATMGeography(
      destinationBankId,
      destinationDistrictId,
      destinationRegionId,
    );

    geographyChanged =
      idOrNull(destinationDistrictId) !== idOrNull(atm.districtId) ||
      idOrNull(destinationRegionId) !== idOrNull(atm.regionId);

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
  if (geographyChanged || hasCustomerUpdate) {
    const districtsToFence = geographyChanged
      ? [atm.districtId, updatePayload.districtId ?? atm.districtId]
      : [];
    const operation = async (session) => {
      const currentATM = await ATM.findOne({
        _id: req.params.id,
        isDeleted: false,
      }).session(session);
      if (!currentATM) throw new ApiError(404, "ATM not found");
      if (geographyChanged) {
        await validateActiveATMGeography(
          updatePayload.bankId ?? currentATM.bankId,
          updatePayload.districtId ?? currentATM.districtId,
          updatePayload.regionId ?? currentATM.regionId,
          session,
        );
        await ensureATMCanMove(currentATM._id, session);
      }
      Object.assign(currentATM, updatePayload);
      if (geographyChanged) currentATM.geographyStatus = "MAPPED";
      currentATM.updatedBy = req.user._id;
      if (hasCustomerUpdate) {
        return assignATMCustomerInTransaction({
          atm: currentATM,
          atmId: currentATM._id,
          customerId,
          updatedBy: req.user._id,
          session,
        });
      }
      await currentATM.save({ session });
      return currentATM;
    };
    updatedATM = await (geographyChanged
      ? withDistrictGeographyFence(districtsToFence, operation)
      : withCustomerAssignmentTransaction(operation)
    ).catch(throwClientAtmIdDuplicateError);
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
    ).catch(throwClientAtmIdDuplicateError);
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
  await publishDomainEventSafely({
    event: "domain:atm-location-request:updated",
    entityType: "atm-location-request",
    entityId: request._id,
    action: "submitted",
    data: { atmId: String(request.atmId) },
    resolveRecipients: () => resolveLocationRequestRecipients(request),
  });
  if (request.locationTaskId) {
    await publishDomainEventSafely({
      event: "domain:atm-location-task:updated",
      entityType: "atm-location-task",
      entityId: request.locationTaskId,
      action: "submitted-for-review",
      data: { atmId: String(request.atmId) },
      resolveRecipients: () => resolveLocationRequestRecipients(request),
    });
  }
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
  const { request, linkedTask } = await approveATMlocationRequest({
    requestId: req.validatedParams.requestId,
    reviewerId: req.user._id,
    includeLinkedTask: true,
  });
  await publishLocationRequestUpdated(request, "approved", { linkedTask });
  return res
    .status(200)
    .json(new ApiResponse(200, request, "ATM location request approved"));
});

export const rejectATMLocationRequest = asyncHandler(async (req, res) => {
  const { request, linkedTask } = await rejectATMlocationRequest({
    requestId: req.validatedParams.requestId,
    reviewerId: req.user._id,
    reason: req.body.reason,
    includeLinkedTask: true,
  });
  await publishLocationRequestUpdated(request, "rejected", { linkedTask });
  return res
    .status(200)
    .json(new ApiResponse(200, request, "ATM location request rejected"));
});

export const reopenATMLocationRequests = asyncHandler(async (req, res) => {
  const result = await reopenATMlocationRequests({
    atmId: req.validatedParams.id,
    reviewerId: req.user._id,
  });
  await publishATMRequestsReopened(result.atmId);
  return res
    .status(200)
    .json(new ApiResponse(200, result, "ATM location requests reopened"));
});

export const createATMLocationTasks = asyncHandler(async (req, res) => {
  const tasks = await createBulkATMLocationTasks({
    tasks: req.body.tasks,
    adminId: req.user._id,
  });
  await Promise.all(
    tasks.map((task) =>
      publishDomainEventSafely({
        event: "domain:atm-location-task:updated",
        entityType: "atm-location-task",
        entityId: task._id,
        action: "assigned",
        data: {
          atmId: String(task.atmId),
          ...(task.locationRequestId
            ? { locationRequestId: String(task.locationRequestId) }
            : {}),
        },
        resolveRecipients: () => resolveLocationTaskRecipients(task),
      }),
    ),
  );
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
  await publishDomainEventSafely({
    event: "domain:atm-location-task:updated",
    entityType: "atm-location-task",
    entityId: task._id,
    action: "started",
    data: {
      atmId: String(task.atmId),
      ...(task.locationRequestId
        ? { locationRequestId: String(task.locationRequestId) }
        : {}),
    },
    resolveRecipients: () => resolveLocationTaskRecipients(task),
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
  await publishDomainEventSafely({
    event: "domain:atm-location-task:updated",
    entityType: "atm-location-task",
    entityId: task._id,
    action: "held",
    data: {
      atmId: String(task.atmId),
      ...(task.locationRequestId
        ? { locationRequestId: String(task.locationRequestId) }
        : {}),
    },
    resolveRecipients: () => resolveLocationTaskRecipients(task),
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
  await publishDomainEventSafely({
    event: "domain:atm-location-task:updated",
    entityType: "atm-location-task",
    entityId: task._id,
    action: "resumed",
    data: {
      atmId: String(task.atmId),
      ...(task.locationRequestId
        ? { locationRequestId: String(task.locationRequestId) }
        : {}),
    },
    resolveRecipients: () => resolveLocationTaskRecipients(task),
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
  await publishDomainEventSafely({
    event: "domain:atm-location-task:updated",
    entityType: "atm-location-task",
    entityId: task._id,
    action: "reassigned",
    data: {
      atmId: String(task.atmId),
      ...(task.locationRequestId
        ? { locationRequestId: String(task.locationRequestId) }
        : {}),
    },
    resolveRecipients: () => resolveLocationTaskRecipients(task),
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
  await publishDomainEventSafely({
    event: "domain:atm-location-task:updated",
    entityType: "atm-location-task",
    entityId: task._id,
    action: "reopened",
    data: {
      atmId: String(task.atmId),
      ...(task.locationRequestId
        ? { locationRequestId: String(task.locationRequestId) }
        : {}),
    },
    resolveRecipients: () => resolveLocationTaskRecipients(task),
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
  await publishDomainEventSafely({
    event: "domain:atm-location-task:updated",
    entityType: "atm-location-task",
    entityId: task._id,
    action: "cancelled",
    data: {
      atmId: String(task.atmId),
      ...(task.locationRequestId
        ? { locationRequestId: String(task.locationRequestId) }
        : {}),
    },
    resolveRecipients: () => resolveLocationTaskRecipients(task),
  });
  return res
    .status(200)
    .json(new ApiResponse(200, task, "ATM location task cancelled"));
});
