import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import AMC from "../amc/amc.model.js";
import ATM from "./atm.model.js";
import ATMLocationRequest from "./atmLocationRequest.model.js";
import Employee from "../employees/employee.model.js";

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

const isDuplicateKeyError = (error) => error?.code === 11000;

export const submitATMlocationRequest = async ({
  atmId,
  requester,
  latitude,
  longitude,
  accuracy,
  inputSource,
  amcId,
}) => {
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

    const isAssignedToATM = (atm.assignedEmployeeId ?? []).some((id) =>
      sameId(id, employee._id),
    );

    if (!isAssignedToATM && !linkedAmcId) {
      throw new ApiError(403, "You are not assigned to this ATM");
    }
    requesterEmployeeId = employee._id;

    if (
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
    const request = await ATMLocationRequest.create({
      atmId: atm._id,
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
    });
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
  requesterId,
}) => {
  const filter = {
    ...(status ? { status } : {}),
    ...(atmId ? { atmId } : {}),
    ...(requesterId ? { requestedBy: requesterId } : {}),
  };
  const skip = (page - 1) * limit;
  const [requests, total] = await Promise.all([
    ATMLocationRequest.find(filter)
      .sort({ submittedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate(
        "atmId",
        "atmId locationName address locationConfigured locationRequestReopenedAt locationRequestWindowOpen",
      )
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
      "atmId locationName address locationConfigured locationRequestReopenedAt locationRequestWindowOpen",
    )
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
}) =>
  withTransaction(async (session) => {
    const reviewedAt = new Date();
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

    return requestView(request);
  });

export const rejectATMlocationRequest = async ({
  requestId,
  reviewerId,
  reason,
}) => {
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
  return requestView(request);
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
