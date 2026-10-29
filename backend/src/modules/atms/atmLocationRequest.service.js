import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import AMC from "../amc/amc.model.js";
import ATM from "./atm.model.js";
import ATMLocationRequest from "./atmLocationRequest.model.js";
import Employee from "../employees/employee.model.js";
import ATMLocationTask from "./atmLocationTask.model.js";
import { taskRequestSubmissionFilter } from "./atmLocationTask.service.js";
import { escapeRegex } from "../../utils/geographicQuery.js";

const sameId = (left, right) =>
  String(left?._id ?? left) === String(right?._id ?? right);

const withTransaction = async (operation) => {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

const sessionQuery = (query, session) =>
  typeof query?.session === "function" ? query.session(session) : query;

const officialLocationSnapshot = (atm) => {
  const coordinates = atm.location?.coordinates;
  return {
    locationConfigured: Boolean(atm.locationConfigured),
    coordinates:
      Array.isArray(coordinates) &&
      coordinates.length === 2 &&
      coordinates.every(Number.isFinite)
        ? [...coordinates]
        : null,
    locationCapturedAt: atm.locationCapturedAt ?? null,
    locationCapturedBy: atm.locationCapturedBy ?? null,
  };
};

const requestView = (request) => ({
  _id: request._id,
  atmId: request.atmId,
  requestType: request.requestType,
  requestedBy: request.requestedBy,
  requesterRole: request.requesterRole,
  requesterEmployeeId: request.requesterEmployeeId,
  amcId: request.amcId,
  locationTaskId: request.locationTaskId,
  proposedLatitude: request.proposedLatitude,
  proposedLongitude: request.proposedLongitude,
  accuracy: request.accuracy,
  inputSource: request.inputSource,
  submittedAt: request.submittedAt,
  officialLocationSnapshot: request.officialLocationSnapshot,
  status: request.status,
  reviewedBy: request.reviewedBy,
  reviewedAt: request.reviewedAt,
  rejectionReason: request.rejectionReason,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
});

const locationTaskEventView = (task) => ({
  _id: task._id,
  atmId: task.atmId,
  assignedEmployeeId: task.assignedEmployeeId,
  createdBy: task.createdBy,
  updatedBy: task.updatedBy,
  assignmentHistory: task.assignmentHistory,
});

const requestMutationResult = (request, linkedTask, includeLinkedTask) => {
  const requestResult = requestView(request);
  return includeLinkedTask
    ? { request: requestResult, linkedTask }
    : requestResult;
};

const isDuplicateKeyError = (error) => error?.code === 11000;

const assertReviewerIsNotRequester = (request, reviewerId) => {
  if (sameId(request.requestedBy, reviewerId)) {
    throw new ApiError(403, "You cannot review your own location request");
  }
};

export const submitATMlocationRequest = async ({
  atmId,
  requester,
  latitude,
  longitude,
  accuracy,
  inputSource,
  amcId,
  locationTaskId,
}) => {
  if (locationTaskId && requester.userType !== "employee") {
    throw new ApiError(403, "Only the assigned employee can submit for a location task");
  }
  const atm = await ATM.findOne({ _id: atmId, isDeleted: false });
  if (!atm) throw new ApiError(404, "ATM not found");

  let requesterEmployeeId = null;
  let linkedAmcId = null;
  let linkedAmc = null;
  if (amcId) {
    linkedAmc = await AMC.findOne({
      _id: amcId,
      atmId: atm._id,
      isDeleted: false,
      ...(requester.userType === "employee"
        ? {
            employeeId: requester._id,
            status: { $in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
          }
        : {}),
    });
    if (!linkedAmc) {
      throw new ApiError(403, "AMC is not associated with this ATM");
    }
    linkedAmcId = linkedAmc._id;
  }

  if (requester.userType === "employee") {
    const employee = await Employee.findOne({
      userId: requester._id,
      status: "active",
    });
    if (!employee) throw new ApiError(403, "Active employee record not found");

    let activeLocationTask = null;
    if (locationTaskId) {
      activeLocationTask = await ATMLocationTask.findOne({
        _id: locationTaskId,
        atmId: atm._id,
        assignedEmployeeId: employee._id,
        active: true,
        status: "IN_PROGRESS",
        locationRequestId: null,
      });
      if (!activeLocationTask) {
        throw new ApiError(
          403,
          "Location task is not active or is no longer assigned to you",
        );
      }
      if (
        (activeLocationTask.taskType === "INITIAL_COLLECTION" &&
          atm.locationConfigured === true) ||
        (activeLocationTask.taskType === "LOCATION_CORRECTION" &&
          atm.locationConfigured !== true)
      ) {
        throw new ApiError(
          409,
          "Location task type no longer matches the ATM's confirmed-location state",
        );
      }
    } else {
      const taskForATM = await ATMLocationTask.findOne({
        atmId: atm._id,
        active: true,
      });
      if (taskForATM) {
        throw new ApiError(
          409,
          "Submit this proposal through the currently assigned location task",
        );
      }
    }

    const isAssignedToATM = (atm.assignedEmployeeId ?? []).some((id) =>
      sameId(id, employee._id),
    );

    if (!activeLocationTask && !isAssignedToATM && !linkedAmcId) {
      throw new ApiError(403, "You are not assigned to this ATM");
    }
    requesterEmployeeId = employee._id;

    if (
      !activeLocationTask &&
      atm.locationConfigured === true &&
      atm.locationRequestWindowOpen !== true
    ) {
      throw new ApiError(
        409,
        "ATM location requests are closed. Contact an Admin to reopen requests for this ATM.",
      );
    }
  }

  const snapshot = officialLocationSnapshot(atm);
  try {
    const requestData = {
      atmId: atm._id,
      locationTaskId: locationTaskId ?? null,
      requestType: snapshot.locationConfigured
        ? "LOCATION_CHANGE"
        : "INITIAL_CONFIGURATION",
      requestedBy: requester._id,
      requesterRole: requester.userType,
      requesterEmployeeId,
      amcId: linkedAmcId,
      proposedLatitude: latitude,
      proposedLongitude: longitude,
      accuracy: accuracy ?? null,
      inputSource,
      officialLocationSnapshot: snapshot,
      status: "PENDING",
    };
    let request;
    if (locationTaskId) {
      request = await withTransaction(async (session) => {
        const [createdRequest] = await ATMLocationRequest.create(
          [requestData],
          { session },
        );
        const updatedTask = await ATMLocationTask.findOneAndUpdate(
          {
            ...taskRequestSubmissionFilter({
              taskId: locationTaskId,
              atmId: atm._id,
              employeeId: requesterEmployeeId,
            }),
            locationRequestId: null,
          },
          {
            $set: {
              status: "PENDING_REVIEW",
              locationRequestId: createdRequest._id,
              updatedBy: requester._id,
            },
          },
          { new: true, runValidators: true, session },
        );
        if (!updatedTask) {
          throw new ApiError(
            409,
            "Location task changed while the proposal was being submitted",
          );
        }
        return createdRequest;
      });
    } else {
      request = await withTransaction(async (session) => {
        const locked = await ATM.bumpLocationWorkflowRevision(atm._id, session);
        if (!locked) throw new ApiError(404, "ATM not found");

        const activeLocationTask = await sessionQuery(
          ATMLocationTask.findOne({ atmId: atm._id, active: true }),
          session,
        );
        if (activeLocationTask) {
          throw new ApiError(
            409,
            "Submit this proposal through the currently assigned location task",
          );
        }

        const [createdRequest] = await ATMLocationRequest.create(
          [requestData],
          { session },
        );
        return createdRequest;
      });
    }
    return requestView(request);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ApiError(
        409,
        "A pending location request already exists for this ATM",
      );
    }
    throw error;
  }
};

export const listATMlocationRequests = async ({
  status,
  page,
  limit,
  atmId,
  search,
  districtId,
  regionId,
  employeeId,
  requesterId,
}) => {
  let matchingATMIds;
  if (search || districtId || regionId) {
    const atmFilter = {
      isDeleted: false,
      ...(districtId ? { districtId } : {}),
      ...(regionId ? { regionId } : {}),
      ...(search
        ? {
            $or: [
              { atmId: { $regex: escapeRegex(search), $options: "i" } },
              { locationName: { $regex: escapeRegex(search), $options: "i" } },
              { address: { $regex: escapeRegex(search), $options: "i" } },
            ],
          }
        : {}),
    };
    matchingATMIds = await ATM.find(atmFilter).distinct("_id");
  }
  const filter = {
    ...(status ? { status } : {}),
    ...(employeeId ? { requesterEmployeeId: employeeId } : {}),
    ...(requesterId ? { requestedBy: requesterId } : {}),
    ...(atmId && matchingATMIds
      ? { $and: [{ atmId }, { atmId: { $in: matchingATMIds } }] }
      : atmId
        ? { atmId }
        : matchingATMIds
          ? { atmId: { $in: matchingATMIds } }
          : {}),
  };
  const skip = (page - 1) * limit;
  const [requests, total] = await Promise.all([
    ATMLocationRequest.find(filter)
      .sort({ submittedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate(
        "atmId",
        "atmId locationName address locationConfigured locationRequestReopenedAt locationRequestWindowOpen districtId regionId",
      )
      .populate("atmId.districtId", "districtName")
      .populate("atmId.regionId", "name")
      .populate("requestedBy", "firstName lastName userType")
      .populate("requesterEmployeeId", "employeeCode")
      .populate("reviewedBy", "firstName lastName userType"),
    ATMLocationRequest.countDocuments(filter),
  ]);
  return {
    requests: requests.map(requestView),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const getATMlocationRequest = async (requestId) => {
  const request = await ATMLocationRequest.findById(requestId)
    .populate(
      "atmId",
      "atmId locationName address locationConfigured locationRequestReopenedAt locationRequestWindowOpen districtId regionId",
    )
    .populate("atmId.districtId", "districtName")
    .populate("atmId.regionId", "name")
    .populate("requestedBy", "firstName lastName userType")
    .populate("requesterEmployeeId", "employeeCode")
    .populate("reviewedBy", "firstName lastName userType");
  if (!request) throw new ApiError(404, "Location request not found");
  return requestView(request);
};

const buildLocationSnapshotFilter = (snapshot) => {
  const filter = {
    isDeleted: false,
    locationConfigured: snapshot.locationConfigured
      ? true
      : { $ne: true },
  };
  filter["location.coordinates"] = snapshot.coordinates ?? null;
  filter.locationCapturedAt = snapshot.locationCapturedAt ?? null;
  filter.locationCapturedBy = snapshot.locationCapturedBy ?? null;
  return filter;
};

export const approveATMlocationRequest = async ({
  requestId,
  reviewerId,
  includeLinkedTask = false,
}) => {
  const result = await withTransaction(async (session) => {
    const reviewedAt = new Date();
    let linkedTask = null;
    const pendingRequest = await sessionQuery(
      ATMLocationRequest.findOne({ _id: requestId, status: "PENDING" }),
      session,
    );
    if (!pendingRequest) {
      throw new ApiError(409, "Location request is no longer pending");
    }
    assertReviewerIsNotRequester(pendingRequest, reviewerId);
    if (!pendingRequest.locationTaskId) {
      const locked = await ATM.bumpLocationWorkflowRevision(
        pendingRequest.atmId,
        session,
      );
      if (!locked) {
        throw new ApiError(409, "ATM is no longer available for location review");
      }
      const activeLocationTask = await sessionQuery(
        ATMLocationTask.findOne({
          atmId: pendingRequest.atmId,
          active: true,
        }),
        session,
      );
      if (activeLocationTask) {
        throw new ApiError(
          409,
          "A location task is active for this ATM; resolve it before approving this request",
        );
      }
    }
    const request = await ATMLocationRequest.findOneAndUpdate(
      { _id: requestId, status: "PENDING" },
      {
        $set: {
          status: "APPROVED",
          reviewedBy: reviewerId,
          reviewedAt,
          rejectionReason: null,
        },
      },
      { new: true, runValidators: true, session },
    );
    if (!request) {
      throw new ApiError(409, "Location request is no longer pending");
    }

    const atm = await ATM.findOneAndUpdate(
      {
        _id: request.atmId,
        ...buildLocationSnapshotFilter(request.officialLocationSnapshot),
      },
      {
        $set: {
          location: {
            type: "Point",
            coordinates: [
              request.proposedLongitude,
              request.proposedLatitude,
            ],
          },
          locationConfigured: true,
          locationCapturedAt: reviewedAt,
          locationCapturedBy: reviewerId,
          locationAccuracy: request.accuracy,
          locationRequestWindowOpen: false,
          locationRequestApproved: true,
          updatedBy: reviewerId,
        },
      },
      { new: true, runValidators: true, session },
    );
    if (!atm) {
      throw new ApiError(
        409,
        "ATM location changed after this request was submitted",
      );
    }

    if (request.locationTaskId) {
      const task = await ATMLocationTask.findOneAndUpdate(
        {
          _id: request.locationTaskId,
          atmId: request.atmId,
          locationRequestId: request._id,
          active: true,
          status: "PENDING_REVIEW",
        },
        {
          $set: {
            status: "COMPLETED",
            active: false,
            completedAt: reviewedAt,
            completedBy: reviewerId,
            updatedBy: reviewerId,
          },
        },
        { new: true, runValidators: true, session },
      );
      if (!task) {
        throw new ApiError(
          409,
          "Location task changed before this proposal could be approved",
        );
      }
      linkedTask = locationTaskEventView(task);
    }

    return requestMutationResult(request, linkedTask, true);
  });
  return includeLinkedTask ? result : result.request;
};

export const rejectATMlocationRequest = async ({
  requestId,
  reviewerId,
  reason,
  includeLinkedTask = false,
}) => {
  const existing = await ATMLocationRequest.findOne({
    _id: requestId,
    status: "PENDING",
  });
  if (!existing) {
    throw new ApiError(409, "Location request is no longer pending");
  }
  assertReviewerIsNotRequester(existing, reviewerId);
  if (existing.locationTaskId) {
    const result = await withTransaction(async (session) => {
      const reviewedAt = new Date();
      const request = await ATMLocationRequest.findOneAndUpdate(
        { _id: requestId, status: "PENDING" },
        {
          $set: {
            status: "REJECTED",
            reviewedBy: reviewerId,
            reviewedAt,
            rejectionReason: reason.trim(),
          },
        },
        { new: true, runValidators: true, session },
      );
      if (!request) {
        throw new ApiError(409, "Location request is no longer pending");
      }
      const task = await ATMLocationTask.findOneAndUpdate(
        {
          _id: request.locationTaskId,
          atmId: request.atmId,
          locationRequestId: request._id,
          active: true,
          status: "PENDING_REVIEW",
        },
        { $set: { status: "REJECTED", updatedBy: reviewerId } },
        { new: true, runValidators: true, session },
      );
      if (!task) {
        throw new ApiError(
          409,
          "Location task changed before this proposal could be rejected",
        );
      }
      return requestMutationResult(
        request,
        locationTaskEventView(task),
        true,
      );
    });
    return includeLinkedTask ? result : result.request;
  }
  const request = await ATMLocationRequest.findOneAndUpdate(
    { _id: requestId, status: "PENDING" },
    {
      $set: {
        status: "REJECTED",
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        rejectionReason: reason.trim(),
      },
    },
    { new: true, runValidators: true },
  );
  if (!request) {
    throw new ApiError(409, "Location request is no longer pending");
  }
  return requestMutationResult(request, null, includeLinkedTask);
};

export const reopenATMlocationRequests = async ({ atmId, reviewerId }) => {
  const hasApprovedRequest = await ATMLocationRequest.exists({
    atmId,
    status: "APPROVED",
  });
  if (!hasApprovedRequest) {
    throw new ApiError(
      409,
      "ATM has no approved location request to reopen",
    );
  }

  const reopenedAt = new Date();
  const atm = await ATM.findOneAndUpdate(
    {
      _id: atmId,
      isDeleted: false,
      locationConfigured: true,
      locationRequestWindowOpen: { $ne: true },
    },
    {
      $set: {
        locationRequestReopenedAt: reopenedAt,
        locationRequestReopenedBy: reviewerId,
        locationRequestWindowOpen: true,
        updatedBy: reviewerId,
      },
      $push: {
        locationRequestReopenHistory: {
          openedAt: reopenedAt,
          openedBy: reviewerId,
        },
      },
    },
    { new: true, runValidators: true },
  );
  if (!atm) {
    throw new ApiError(
      409,
      "ATM is not eligible for reopening or requests are already open",
    );
  }
  return {
    atmId: atm._id,
    locationRequestReopenedAt: atm.locationRequestReopenedAt,
    locationRequestReopenedBy: atm.locationRequestReopenedBy,
    locationRequestWindowOpen: atm.locationRequestWindowOpen,
  };
};
