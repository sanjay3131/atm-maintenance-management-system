import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import { publishDomainEventSafely } from "../../realtime/domain-events.js";
import { resolveDistrictTransferRecipients } from "../../realtime/recipient-resolver.js";
import ATM from "../atms/atm.model.js";
import Customer from "../customers/customer.model.js";
import Employee from "../employees/employee.model.js";
import Job from "../jobs/jobs.model.js";
import RecurringMaintenancePlan from "../jobs/recurringMaintenancePlan.model.js";
import AMC from "../amc/amc.model.js";
import { AMC_STATUS } from "../amc/amc.config.js";
import { JOB_STATUS } from "../../utils/jobStatus.js";
import Region from "../region/region.model.js";
import District from "./district.models.js";
import DistrictTransferAudit from "./districtTransferAudit.model.js";
import { withDistrictGeographyFence } from "./districtGeography.service.js";
import Bank from "../banks/bank.model.js";
import { districtNormalizedValues } from "./districtNormalization.js";

const isDuplicateKey = (error) => error?.code === 11000;
const duplicateKeyField = (error) => {
  const keyPattern = error?.keyPattern ?? {};
  const indexName = `${error?.index ?? ""} ${error?.message ?? ""}`;
  if (
    (keyPattern.bankId && keyPattern.districtNameNormalized) ||
    indexName.includes("uniq_district_bank_name_normalized")
  ) {
    return "name";
  }
  if (
    (keyPattern.bankId && keyPattern.pinCodeNormalized) ||
    indexName.includes("uniq_district_bank_pin_normalized")
  ) {
    return "pincode";
  }
  return "unknown";
};
const throwDistrictDuplicateError = (error) => {
  if (!isDuplicateKey(error)) throw error;
  const field = duplicateKeyField(error);
  const message =
    field === "name"
      ? "District name already exists in this bank"
      : field === "pincode"
        ? "District PIN code already exists in this bank"
        : "District index conflict; verify the installed geography indexes";
  throw new ApiError(409, message);
};

const assertDistrictUniqueness = async ({
  bankId,
  districtNameNormalized,
  pinCodeNormalized,
  excludeId,
}) => {
  const existingDistricts = await District.find({
    bankId,
    geographyStatus: "MAPPED",
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select("_id districtName pinCode")
    .lean();
  for (const existing of existingDistricts) {
    let existingValues;
    try {
      existingValues = districtNormalizedValues(existing);
    } catch {
      throw new ApiError(
        409,
        "A District under this bank has invalid geography and requires reconciliation",
      );
    }
    if (existingValues.districtNameNormalized === districtNameNormalized) {
      throw new ApiError(409, "District name already exists in this bank");
    }
    if (existingValues.pinCodeNormalized === pinCodeNormalized) {
      throw new ApiError(409, "District PIN code already exists in this bank");
    }
  }
};

export const createDistrict = asyncHandler(async (req, res) => {
  const { regionId, districtName, pinCode, state, isActive = true } = req.body;
  const region = await Region.findById(regionId).populate("bankId", "isActive");
  if (!region) throw new ApiError(404, "Region not found");
  if (
    region.geographyStatus !== "MAPPED" ||
    !region.isActive ||
    !region.bankId?.isActive
  ) {
    throw new ApiError(400, "Cannot add a district to inactive geography");
  }
  const bankId = region.bankId._id ?? region.bankId;
  const normalizedValues = districtNormalizedValues({ districtName, pinCode });
  await assertDistrictUniqueness({ bankId, ...normalizedValues });

  try {
    const district = await District.create({
      bankId,
      regionId,
      geographyStatus: "MAPPED",
      districtName,
      pinCode,
      ...normalizedValues,
      state,
      isActive,
      createdBy: req.user._id,
    });
    return res
      .status(201)
      .json(new ApiResponse(201, district, "District created successfully"));
  } catch (error) {
    throwDistrictDuplicateError(error);
  }
});

export const getAllDistricts = asyncHandler(async (req, res) => {
  const query = {};
  const regionId = req.validatedParams?.regionId ?? req.query.regionId;
  const bankId = req.validatedQuery?.bankId ?? req.query.bankId;
  const isActive = req.validatedQuery?.isActive ?? req.query.isActive;
  if (bankId) query.bankId = bankId;
  if (regionId) query.regionId = regionId;
  if (isActive !== undefined) query.isActive = isActive === "true";
  const districts = await District.find(query)
    .populate({
      path: "regionId",
      select: "name bankId isActive",
      populate: { path: "bankId", select: "bankName bankCode isActive" },
    })
    .sort({ districtName: 1 });
  return res
    .status(200)
    .json(new ApiResponse(200, districts, "Districts retrieved successfully"));
});

export const getDistrictGeographicSummaries = asyncHandler(async (_req, res) => {
  const [districts, [atmCounts = {}]] = await Promise.all([
    District.find().select("_id regionId").lean(),
    ATM.aggregate([
      { $match: { isDeleted: false } },
      {
        $facet: {
          atms: [{ $group: { _id: "$districtId", total: { $sum: 1 } } }],
          employees: [
            { $unwind: "$assignedEmployeeId" },
            { $match: { assignedEmployeeId: { $ne: null } } },
            {
              $group: {
                _id: {
                  districtId: "$districtId",
                  employeeId: "$assignedEmployeeId",
                },
              },
            },
            {
              $lookup: {
                from: Employee.collection.name,
                localField: "_id.employeeId",
                foreignField: "_id",
                as: "employee",
              },
            },
            { $match: { "employee.0": { $exists: true } } },
            { $group: { _id: "$_id.districtId", total: { $sum: 1 } } },
          ],
          customers: [
            { $match: { customer: { $ne: null } } },
            {
              $group: {
                _id: { districtId: "$districtId", customerId: "$customer" },
              },
            },
            {
              $lookup: {
                from: Customer.collection.name,
                let: { customerId: "$_id.customerId" },
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
            { $group: { _id: "$_id.districtId", total: { $sum: 1 } } },
          ],
        },
      },
    ]),
  ]);

  const summaries = new Map(
    districts.map((district) => [
      String(district._id),
      {
        districtId: String(district._id),
        regions: district.regionId ? 1 : 0,
        atms: 0,
        employees: 0,
        customers: 0,
      },
    ]),
  );
  const increment = (rows, field) => {
    for (const { _id, total } of rows) {
      const id = String(_id);
      const summary = summaries.get(id) ?? {
        districtId: id,
        regions: 0,
        atms: 0,
        employees: 0,
        customers: 0,
      };
      summary[field] = total;
      summaries.set(id, summary);
    }
  };
  increment(atmCounts.atms ?? [], "atms");
  increment(atmCounts.employees ?? [], "employees");
  increment(atmCounts.customers ?? [], "customers");

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        [...summaries.values()],
        "District geographic summaries retrieved successfully",
      ),
    );
});

export const getDistrictById = asyncHandler(async (req, res) => {
  const district = await District.findById(req.params.id).populate({
    path: "regionId",
    select: "name bankId isActive",
    populate: { path: "bankId", select: "bankName bankCode isActive" },
  });
  if (!district) throw new ApiError(404, "District not found");
  return res
    .status(200)
    .json(new ApiResponse(200, district, "District retrieved successfully"));
});

export const updateDistrict = asyncHandler(async (req, res) => {
  const district = await District.findById(req.params.id);
  if (!district) throw new ApiError(404, "District not found");
  if (!district.regionId || district.geographyStatus !== "MAPPED") {
    throw new ApiError(409, "Map the district to a region before updating it");
  }
  const region = await Region.findById(district.regionId).populate(
    "bankId",
    "isActive",
  );
  if (
    !region ||
    !region.bankId ||
    region.geographyStatus !== "MAPPED" ||
    String(district.bankId) !== String(region.bankId._id ?? region.bankId)
  ) {
    throw new ApiError(409, "District geography is inconsistent and requires reconciliation");
  }
  if (
    req.body.isActive === true &&
    (!region.isActive || !region.bankId.isActive)
  ) {
    throw new ApiError(400, "Cannot activate a district under inactive geography");
  }
  if (
    req.body.isActive === true &&
    (!district.regionId || district.geographyStatus !== "MAPPED")
  ) {
    throw new ApiError(409, "Map the district to a region before activating it");
  }
  const districtName = req.body.districtName ?? district.districtName;
  const pinCode = req.body.pinCode ?? district.pinCode;
  const normalizedValues = districtNormalizedValues({ districtName, pinCode });
  await assertDistrictUniqueness({
    bankId: district.bankId,
    ...normalizedValues,
    excludeId: district._id,
  });
  let updatedDistrict;
  try {
    updatedDistrict = await District.findByIdAndUpdate(
      district._id,
      {
        $set: {
          ...req.body,
          ...normalizedValues,
          updatedBy: req.user._id,
        },
      },
      { new: true, runValidators: true },
    );
  } catch (error) {
    throwDistrictDuplicateError(error);
  }
  if (!updatedDistrict) throw new ApiError(404, "District not found");
  return res
    .status(200)
    .json(new ApiResponse(200, updatedDistrict, "District updated successfully"));
});

export const deactivateDistrict = asyncHandler(async (req, res) => {
  const district = await District.findByIdAndUpdate(
    req.params.id,
    { $set: { isActive: false, updatedBy: req.user._id } },
    { new: true, runValidators: true },
  );
  if (!district) throw new ApiError(404, "District not found");
  return res
    .status(200)
    .json(new ApiResponse(200, district, "District deactivated successfully"));
});

export const transferDistrict = asyncHandler(async (req, res) => {
  const { id: districtId } = req.params;
  const { regionId: destinationRegionId, reason } = req.body;

  const transfer = await withDistrictGeographyFence(
    [districtId],
    async (session) => {
      const district = await District.findById(districtId).session(session);
      if (!district) throw new ApiError(404, "District not found");
      const sourceRegion = await Region.findById(district.regionId)
        .select("bankId isActive name geographyStatus")
        .session(session);
      const destinationRegion = await Region.findById(destinationRegionId)
        .select("bankId isActive name geographyStatus")
        .session(session);
      if (!sourceRegion) throw new ApiError(409, "District has no valid source region");
      if (!destinationRegion) throw new ApiError(404, "Destination region not found");
      if (
        district.geographyStatus !== "MAPPED" ||
        sourceRegion.geographyStatus !== "MAPPED" ||
        destinationRegion.geographyStatus !== "MAPPED"
      ) {
        throw new ApiError(409, "Map the district and its regions before transferring");
      }
      if (!sourceRegion.isActive || !destinationRegion.isActive) {
        throw new ApiError(400, "District transfers require active source and destination regions");
      }
      if (String(sourceRegion.bankId) !== String(destinationRegion.bankId)) {
        throw new ApiError(400, "A district can only be transferred within the same bank");
      }
      if (String(district.bankId) !== String(sourceRegion.bankId)) {
        throw new ApiError(
          409,
          "District bank does not match its source region and requires reconciliation",
        );
      }
      let normalizedValues;
      try {
        normalizedValues = districtNormalizedValues(district);
      } catch {
        throw new ApiError(409, "District normalized geography requires reconciliation");
      }
      if (
        district.districtNameNormalized !== normalizedValues.districtNameNormalized ||
        district.pinCodeNormalized !== normalizedValues.pinCodeNormalized
      ) {
        throw new ApiError(409, "District normalized geography requires reconciliation");
      }
      const bank = await Bank.findById(sourceRegion.bankId)
        .select("_id isActive")
        .session(session);
      if (!bank?.isActive) {
        throw new ApiError(400, "District transfers require an active bank");
      }
      if (String(district.regionId) === String(destinationRegion._id)) {
        throw new ApiError(400, "District already belongs to the selected region");
      }
      const duplicateName = await District.findOne({
        _id: { $ne: districtId },
        bankId: sourceRegion.bankId,
        districtNameNormalized: normalizedValues.districtNameNormalized,
        geographyStatus: "MAPPED",
      })
        .select("_id")
        .session(session)
        .lean();
      if (duplicateName) {
        throw new ApiError(409, "District name already exists in this bank");
      }
      const duplicatePin = await District.findOne({
        _id: { $ne: districtId },
        bankId: sourceRegion.bankId,
        pinCodeNormalized: normalizedValues.pinCodeNormalized,
        geographyStatus: "MAPPED",
      })
        .select("_id")
        .session(session)
        .lean();
      if (duplicatePin) {
        throw new ApiError(409, "District PIN code already exists in this bank");
      }

      const atms = await ATM.find({ districtId, isDeleted: false })
        .select("_id atmId clientAtmId bankId regionId geographyStatus")
        .session(session)
        .lean();
      const inconsistentATM = atms.find(
        (atm) =>
          String(atm.bankId) !== String(sourceRegion.bankId) ||
          String(atm.regionId) !== String(sourceRegion._id) ||
          atm.geographyStatus !== "MAPPED",
      );
      if (inconsistentATM) {
        throw new ApiError(
          409,
          `ATM ${inconsistentATM.clientAtmId?.trim() || inconsistentATM.atmId} does not match the district's source geography and must be reconciled before transfer`,
        );
      }
      const atmIds = atms.map((atm) => atm._id);
      const blockers = {
        jobs: [],
        amcs: [],
        recurringPlans: [],
      };
      if (atmIds.length > 0) {
        blockers.jobs = await Job.find({
          atmId: { $in: atmIds },
          isDeleted: false,
          status: { $nin: [JOB_STATUS.CLOSED, JOB_STATUS.CANCELLED] },
        })
          .select("_id jobId atmId status")
          .session(session)
          .lean();
        blockers.amcs = await AMC.find({
          atmId: { $in: atmIds },
          isDeleted: false,
          status: {
            $in: [AMC_STATUS.PENDING, AMC_STATUS.IN_PROGRESS, AMC_STATUS.OVERDUE],
          },
        })
          .select("_id amcId atmId status")
          .session(session)
          .lean();
        blockers.recurringPlans = await RecurringMaintenancePlan.find({
          atmId: { $in: atmIds },
          isActive: true,
        })
          .select("_id atmId maintenanceType")
          .session(session)
          .lean();
      }
      const blockerSummary = {
        jobs: blockers.jobs.length,
        amcs: blockers.amcs.length,
        recurringPlans: blockers.recurringPlans.length,
      };
      if (Object.values(blockerSummary).some((count) => count > 0)) {
        throw new ApiError(409, "District transfer is blocked by unresolved maintenance records", [{
          ...blockerSummary,
          details: {
            jobs: blockers.jobs.slice(0, 25),
            amcs: blockers.amcs.slice(0, 25),
            recurringPlans: blockers.recurringPlans.slice(0, 25),
          },
        }]);
      }

      let districtUpdate;
      try {
        districtUpdate = await District.updateOne(
          {
            _id: districtId,
            regionId: sourceRegion._id,
            geographyStatus: "MAPPED",
          },
          {
            $set: {
              regionId: destinationRegion._id,
              updatedBy: req.user._id,
            },
          },
          { session, runValidators: true },
        );
      } catch (error) {
        throwDistrictDuplicateError(error);
      }
      if (districtUpdate.matchedCount !== 1) {
        throw new ApiError(
          409,
          "District parent region changed during transfer; retry the operation",
        );
      }

      const atmUpdate = await ATM.updateMany(
        { districtId, isDeleted: false },
        {
          $set: {
            regionId: destinationRegion._id,
            geographyStatus: "MAPPED",
            updatedBy: req.user._id,
          },
        },
        { session, runValidators: true },
      );
      if (atmUpdate.matchedCount !== atms.length) {
        throw new ApiError(
          409,
          "The affected ATM set changed during transfer; no changes were committed",
        );
      }

      const updatedDistrict = await District.findById(districtId).session(session);
      if (
        String(updatedDistrict?.regionId) !== String(destinationRegion._id) ||
        String(updatedDistrict?.bankId) !== String(destinationRegion.bankId) ||
        updatedDistrict?.districtNameNormalized !==
          normalizedValues.districtNameNormalized ||
        updatedDistrict?.pinCodeNormalized !== normalizedValues.pinCodeNormalized
      ) {
        throw new ApiError(
          409,
          "District geography verification failed; no changes were committed",
        );
      }

      const updatedATMs = await ATM.find({ districtId, isDeleted: false })
        .select("_id regionId bankId")
        .session(session)
        .lean();
      if (updatedATMs.length !== atms.length) {
        throw new ApiError(
          409,
          "Affected ATM count verification failed; no changes were committed",
        );
      }
      const inconsistentUpdatedATM = updatedATMs.find(
        (atm) =>
          String(atm.regionId) !== String(destinationRegion._id) ||
          String(atm.bankId) !== String(destinationRegion.bankId),
      );
      if (inconsistentUpdatedATM) {
        throw new ApiError(
          409,
          "ATM geography verification failed; no changes were committed",
        );
      }

      const [audit] = await DistrictTransferAudit.create(
        [
          {
            districtId,
            fromRegionId: sourceRegion._id,
            fromRegionName: sourceRegion.name,
            toRegionId: destinationRegion._id,
            toRegionName: destinationRegion.name,
            reason,
            affectedATMCount: atms.length,
            performedBy: req.user._id,
          },
        ],
        { session },
      );
      return {
        audit,
        districtId: String(districtId),
        fromRegionId: String(sourceRegion._id),
        toRegionId: String(destinationRegion._id),
        affectedATMCount: atms.length,
      };
    },
  );

  await publishDomainEventSafely({
    event: "domain:district:transferred",
    entityType: "district",
    entityId: transfer.districtId,
    action: "transferred",
    data: {
      transferId: String(transfer.audit._id),
      fromRegionId: transfer.fromRegionId,
      toRegionId: transfer.toRegionId,
      affectedATMCount: transfer.affectedATMCount,
    },
    resolveRecipients: () =>
      resolveDistrictTransferRecipients(transfer.districtId),
  });

  return res
    .status(200)
    .json(new ApiResponse(200, transfer.audit, "District transferred successfully"));
});

export const getDistrictTransfers = asyncHandler(async (req, res) => {
  const district = await District.exists({ _id: req.params.id });
  if (!district) throw new ApiError(404, "District not found");
  const transfers = await DistrictTransferAudit.find({ districtId: req.params.id })
    .populate("fromRegionId", "name")
    .populate("toRegionId", "name")
    .populate("performedBy", "firstName lastName")
    .sort({ createdAt: -1 })
    .limit(100);
  return res
    .status(200)
    .json(new ApiResponse(200, transfers, "District transfers retrieved successfully"));
});

export const deleteDistrict = deactivateDistrict;
