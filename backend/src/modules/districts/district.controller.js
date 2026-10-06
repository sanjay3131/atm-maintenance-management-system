import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import District from "./district.models.js";
import ATM from "../atms/atm.model.js";
import Customer from "../customers/customer.model.js";
import Employee from "../employees/employee.model.js";
import Region from "../region/region.model.js";

export const createDistrict = asyncHandler(async (req, res) => {
  const { districtName, pinCode, state, isActive = true } = req.body;

  const existingDistrict = await District.findOne({
    $or: [{ districtName }, { pinCode }],
  });

  if (existingDistrict) {
    throw new ApiError(
      409,
      "District with this name or pin code already exists",
    );
  }

  const district = await District.create({
    districtName,
    pinCode,
    state,
    isActive,
    createdBy: req.user._id,
  });

  return res
    .status(201)
    .json(new ApiResponse(201, district, "District created successfully"));
});

export const getAllDistricts = asyncHandler(async (req, res) => {
  const districts = await District.find().sort({ districtName: 1 });

  return res
    .status(200)
    .json(new ApiResponse(200, districts, "Districts retrieved successfully"));
});

export const getDistrictGeographicSummaries = asyncHandler(
  async (_req, res) => {
    const [regionCounts, [atmCounts = {}]] = await Promise.all([
      Region.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: "$districtId", total: { $sum: 1 } } },
      ]),
      ATM.aggregate([
        { $match: { isDeleted: false } },
        {
          $facet: {
            atms: [
              { $group: { _id: "$districtId", total: { $sum: 1 } } },
            ],
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
              {
                $group: {
                  _id: "$_id.districtId",
                  total: { $sum: 1 },
                },
              },
            ],
            customers: [
              { $match: { customer: { $ne: null } } },
              {
                $group: {
                  _id: {
                    districtId: "$districtId",
                    customerId: "$customer",
                  },
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
              {
                $group: {
                  _id: "$_id.districtId",
                  total: { $sum: 1 },
                },
              },
            ],
          },
        },
      ]),
    ]);

    const summaries = new Map();
    const increment = (rows, field) => {
      for (const { _id, total } of rows) {
        const districtId = _id.toString();
        const summary = summaries.get(districtId) ?? {
          districtId,
          regions: 0,
          atms: 0,
          employees: 0,
          customers: 0,
        };
        summary[field] = total;
        summaries.set(districtId, summary);
      }
    };

    increment(regionCounts, "regions");
    increment(atmCounts.atms ?? [], "atms");
    increment(atmCounts.employees ?? [], "employees");
    increment(atmCounts.customers ?? [], "customers");

    return res.status(200).json(
      new ApiResponse(
        200,
        [...summaries.values()],
        "District geographic summaries retrieved successfully",
      ),
    );
  },
);

export const getDistrictById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const district = await District.findById(id);

  if (!district) {
    throw new ApiError(404, "District not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, district, "District retrieved successfully"));
});

export const updateDistrict = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { districtName, pinCode, state, isActive } = req.body;

  const district = await District.findById(id);

  if (!district) {
    throw new ApiError(404, "District not found");
  }

  if (districtName && districtName !== district.districtName) {
    const duplicate = await District.findOne({ districtName });
    if (duplicate && duplicate._id.toString() !== district._id.toString()) {
      throw new ApiError(409, "District with this name already exists");
    }
  }

  if (pinCode && pinCode !== district.pinCode) {
    const duplicate = await District.findOne({ pinCode });
    if (duplicate && duplicate._id.toString() !== district._id.toString()) {
      throw new ApiError(409, "District with this pin code already exists");
    }
  }

  const updatedDistrict = await District.findByIdAndUpdate(
    id,
    {
      ...(districtName && { districtName }),
      ...(pinCode && { pinCode }),
      ...(state && { state }),
      ...(typeof isActive === "boolean" && { isActive }),
      updatedBy: req.user._id,
    },
    { new: true, runValidators: true },
  );

  return res
    .status(200)
    .json(
      new ApiResponse(200, updatedDistrict, "District updated successfully"),
    );
});

export const deleteDistrict = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const district = await District.findByIdAndDelete(id);

  if (!district) {
    throw new ApiError(404, "District not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, null, "District deleted successfully"));
});
