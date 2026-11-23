import mongoose from "mongoose";
import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import { escapeRegex } from "../../utils/geographicQuery.js";
import ATM from "../atms/atm.model.js";
import Bank from "../banks/bank.model.js";
import Customer from "../customers/customer.model.js";
import District from "../districts/district.models.js";
import Employee from "../employees/employee.model.js";
import Region from "./region.model.js";

const isDuplicateKey = (error) => error?.code === 11000;
const isBankScopedRegionDuplicate = (error) => {
  const keyPattern = error?.keyPattern ?? {};
  const indexName = `${error?.index ?? ""} ${error?.message ?? ""}`;
  return (
    (keyPattern.bankId && (keyPattern.name || keyPattern.code)) ||
    indexName.includes("bankId_1_name_1") ||
    indexName.includes("bankId_1_code_1")
  );
};

const throwRegionDuplicateError = (error) => {
  if (!isDuplicateKey(error)) throw error;
  throw new ApiError(
    409,
    isBankScopedRegionDuplicate(error)
      ? "Region name or code already exists in this bank"
      : "Region index conflict; verify the installed geography indexes",
  );
};

export const createRegion = asyncHandler(async (req, res) => {
  const { bankId, name, code, description, isActive = true } = req.body;
  const bank = await Bank.findById(bankId).select("_id isActive");
  if (!bank) throw new ApiError(404, "Bank not found");
  if (!bank.isActive) throw new ApiError(400, "Cannot add a region to an inactive bank");

  try {
    const region = await Region.create({
      bankId,
      geographyStatus: "MAPPED",
      name,
      code: code?.toUpperCase() || undefined,
      description: description || "",
      isActive,
      createdBy: req.user._id,
    });
    return res
      .status(201)
      .json(new ApiResponse(201, region, "Region created successfully"));
  } catch (error) {
    throwRegionDuplicateError(error);
  }
});

export const getAllRegions = asyncHandler(async (req, res) => {
  const query =
    req.query.includeInactive === "true"
      ? {}
      : { isActive: true, geographyStatus: "MAPPED" };
  const regions = await Region.find(query)
    .populate("bankId", "bankName bankCode")
    .sort({ name: 1 });
  return res
    .status(200)
    .json(new ApiResponse(200, regions, "Regions retrieved successfully"));
});

export const getRegionsByBank = asyncHandler(async (req, res) => {
  const { bankId } = req.params;
  const bank = await Bank.findById(bankId).select("_id");
  if (!bank) throw new ApiError(404, "Bank not found");

  const query = { bankId };
  if (req.query.includeInactive !== "true") {
    query.isActive = true;
    query.geographyStatus = "MAPPED";
  }
  const regions = await Region.find(query).populate("bankId", "bankName bankCode").sort({ name: 1 });
  return res
    .status(200)
    .json(new ApiResponse(200, regions, "Regions retrieved successfully"));
});

export const getRegionSummaries = asyncHandler(async (req, res) => {
  const filters = req.validatedQuery ?? req.query;
  const match = {};

  if (filters.status) match.isActive = filters.status === "active";
  if (filters.bankId) {
    match.bankId = new mongoose.Types.ObjectId(filters.bankId);
  }
  if (filters.search) {
    const search = escapeRegex(filters.search);
    match.$or = [
      { name: { $regex: search, $options: "i" } },
      { code: { $regex: search, $options: "i" } },
    ];
  }

  const regions = await Region.aggregate([
    { $match: match },
    { $sort: { name: 1, _id: 1 } },
    {
      $lookup: {
        from: District.collection.name,
        let: { regionId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$regionId", "$$regionId"] },
              isDeleted: { $ne: true },
            },
          },
          { $count: "count" },
        ],
        as: "districtSummary",
      },
    },
    {
      $lookup: {
        from: ATM.collection.name,
        let: { regionId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$regionId", "$$regionId"] },
              isDeleted: { $ne: true },
            },
          },
          {
            $facet: {
              atms: [{ $count: "count" }],
              employees: [
                { $unwind: "$assignedEmployeeId" },
                { $match: { assignedEmployeeId: { $ne: null } } },
                { $group: { _id: "$assignedEmployeeId" } },
                {
                  $lookup: {
                    from: Employee.collection.name,
                    localField: "_id",
                    foreignField: "_id",
                    pipeline: [
                      { $match: { isDeleted: { $ne: true } } },
                      { $project: { _id: 1 } },
                    ],
                    as: "employee",
                  },
                },
                { $match: { "employee.0": { $exists: true } } },
                { $count: "count" },
              ],
              customers: [
                { $match: { customer: { $ne: null } } },
                { $group: { _id: "$customer" } },
                {
                  $lookup: {
                    from: Customer.collection.name,
                    localField: "_id",
                    foreignField: "_id",
                    pipeline: [
                      { $match: { isDeleted: { $ne: true } } },
                      { $project: { _id: 1 } },
                    ],
                    as: "customer",
                  },
                },
                { $match: { "customer.0": { $exists: true } } },
                { $count: "count" },
              ],
            },
          },
          {
            $project: {
              atms: {
                $ifNull: [{ $arrayElemAt: ["$atms.count", 0] }, 0],
              },
              employees: {
                $ifNull: [{ $arrayElemAt: ["$employees.count", 0] }, 0],
              },
              customers: {
                $ifNull: [{ $arrayElemAt: ["$customers.count", 0] }, 0],
              },
            },
          },
        ],
        as: "atmSummary",
      },
    },
    {
      $lookup: {
        from: Bank.collection.name,
        localField: "bankId",
        foreignField: "_id",
        pipeline: [{ $project: { _id: 1, bankName: 1, bankCode: 1 } }],
        as: "parentBank",
      },
    },
    {
      $project: {
        _id: 0,
        regionId: "$_id",
        name: 1,
        code: 1,
        description: 1,
        isActive: 1,
        bank: {
          $let: {
            vars: { bank: { $arrayElemAt: ["$parentBank", 0] } },
            in: {
              $cond: [
                { $ifNull: ["$$bank", false] },
                {
                  id: "$$bank._id",
                  name: "$$bank.bankName",
                  code: { $ifNull: ["$$bank.bankCode", null] },
                },
                null,
              ],
            },
          },
        },
        counts: {
          districts: {
            $ifNull: [{ $arrayElemAt: ["$districtSummary.count", 0] }, 0],
          },
          atms: { $ifNull: [{ $arrayElemAt: ["$atmSummary.atms", 0] }, 0] },
          employees: {
            $ifNull: [{ $arrayElemAt: ["$atmSummary.employees", 0] }, 0],
          },
          customers: {
            $ifNull: [{ $arrayElemAt: ["$atmSummary.customers", 0] }, 0],
          },
        },
      },
    },
  ]);

  return res
    .status(200)
    .json(new ApiResponse(200, regions, "Region summaries retrieved successfully"));
});

export const getRegionById = asyncHandler(async (req, res) => {
  const region = await Region.findById(req.params.id).populate(
    "bankId",
    "bankName bankCode",
  );
  if (!region) throw new ApiError(404, "Region not found");
  return res
    .status(200)
    .json(new ApiResponse(200, region, "Region retrieved successfully"));
});

export const updateRegion = asyncHandler(async (req, res) => {
  const region = await Region.findById(req.params.id);
  if (!region) throw new ApiError(404, "Region not found");
  if (
    req.body.isActive === true &&
    (!region.bankId || region.geographyStatus !== "MAPPED")
  ) {
    throw new ApiError(409, "Map the region to a bank before activating it");
  }

  Object.assign(region, req.body);
  if (req.body.code !== undefined) region.code = req.body.code.toUpperCase() || undefined;
  region.updatedBy = req.user._id;

  try {
    await region.save();
  } catch (error) {
    throwRegionDuplicateError(error);
  }
  await region.populate("bankId", "bankName bankCode");
  return res
    .status(200)
    .json(new ApiResponse(200, region, "Region updated successfully"));
});

export const deactivateRegion = asyncHandler(async (req, res) => {
  const region = await Region.findByIdAndUpdate(
    req.params.id,
    { $set: { isActive: false, updatedBy: req.user._id } },
    { new: true, runValidators: true },
  );
  if (!region) throw new ApiError(404, "Region not found");
  return res
    .status(200)
    .json(new ApiResponse(200, region, "Region deactivated successfully"));
});

const listDistrictParentRegion = async (req, res, includeInactive) => {
  const district = await District.findById(req.params.districtId).select("regionId");
  if (!district) throw new ApiError(404, "District not found");
  const region = district.regionId
    ? await Region.findById(district.regionId).populate("bankId", "bankName bankCode")
    : null;
  const result = region && (includeInactive || region.isActive)
    ? [region]
    : [];
  return res
    .status(200)
    .json(new ApiResponse(200, result, "District's parent region retrieved successfully"));
};

export const listRegionsByDistrict = asyncHandler((req, res) =>
  listDistrictParentRegion(req, res, false),
);
export const listAllRegionsByDistrict = asyncHandler((req, res) =>
  listDistrictParentRegion(req, res, true),
);
export const getRegionsByDistrict = listRegionsByDistrict;
export const getAllRegionsByDistrict = listAllRegionsByDistrict;
export const deleteRegion = deactivateRegion;
