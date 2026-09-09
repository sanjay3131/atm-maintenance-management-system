import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import District from "./district.models.js";

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
