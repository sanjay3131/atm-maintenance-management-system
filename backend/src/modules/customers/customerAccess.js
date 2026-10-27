import ApiError from "../../utils/ApiError.js";
import Customer from "./customer.model.js";

export const getActiveCustomerForUser = async (user) => {
  if (user?.userType !== "customer" || user.status !== "active") {
    throw new ApiError(404, "Customer profile not found");
  }

  const customer = await Customer.findOne({
    userId: user._id,
    isActive: true,
    isDeleted: false,
  });

  if (!customer) {
    throw new ApiError(404, "Customer profile not found");
  }

  return customer;
};

export const sameCustomerId = (value, customerId) =>
  String(value?._id ?? value ?? "") === String(customerId);

const asRecord = (value) =>
  typeof value?.toObject === "function" ? value.toObject() : value;

export const toCustomerSafeJob = (job) => {
  const record = asRecord(job);
  const atm = asRecord(record.atmId);
  return {
    _id: record._id,
    jobId: record.jobId,
    jobNumber: record.jobNumber,
    title: record.title,
    description: record.description,
    atmId:
      atm && typeof atm === "object"
        ? {
            _id: atm._id,
            atmId: atm.atmId,
            locationName: atm.locationName,
            address: atm.address,
          }
        : atm,
    status: record.status,
    workType: record.workType,
    acSubType: record.acSubType,
    priority: record.priority,
    createdAt: record.createdAt,
    assignedAt: record.assignedAt,
    acceptedAt: record.acceptedAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    verifiedAt: record.verifiedAt,
    approvedAt: record.approvedAt,
    closedAt: record.closedAt,
  };
};

export const toCustomerSafeHistory = (entry) => {
  const record = asRecord(entry);
  return {
    _id: record._id,
    action: record.action,
    fromStatus: record.fromStatus,
    toStatus: record.toStatus,
    performedAt: record.performedAt,
  };
};

export const toCustomerSafeJobPhoto = (photo) => {
  const record = asRecord(photo);
  return {
    _id: record._id,
    url: record.url,
    thumbnailUrl: record.thumbnailUrl,
    photoType: record.photoType,
    uploadedAt: record.uploadedAt,
  };
};

export const toCustomerSafeAMCPhoto = (photo) => {
  const record = asRecord(photo);
  return {
    _id: record._id,
    uploadedAt: record.uploadedAt,
  };
};

export const toCustomerSafeAMC = (amc) => {
  const record = asRecord(amc);
  const atm = asRecord(record.atmId);
  return {
    _id: record._id,
    amcId: record.amcId,
    atmId:
      atm && typeof atm === "object"
        ? {
            _id: atm._id,
            atmId: atm.atmId,
            locationName: atm.locationName,
            address: atm.address,
          }
        : atm,
    month: record.month,
    year: record.year,
    status: record.status,
    deadlineDate: record.deadlineDate,
    visitDate: record.visitDate,
    completedAt: record.completedAt,
    checklistCompleted: record.checklistCompleted,
    checklist: Array.isArray(record.checklist)
      ? record.checklist.map(({ item, response, remarks }) => ({
          item,
          response,
          remarks,
        }))
      : [],
    photoCount: record.photoCount,
    generatedAt: record.generatedAt,
  };
};
