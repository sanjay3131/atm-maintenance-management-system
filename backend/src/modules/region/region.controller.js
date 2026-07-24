import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import Region from "./region.model.js";
import District from "../districts/district.models.js";

export const createRegion = asyncHandler(async (req, res) => {
  const { districtId, name, code, description, isActive = true } = req.body;

  const district = await District.findById(districtId);

  if (!district) {
    throw new ApiError(404, "District not found");
  }

  const existingRegion = await Region.findOne({ districtId, name });

  if (existingRegion) {
    throw new ApiError(
      409,
      "Region with this name already exists in this district",
    );
  }

  if (code) {
    const duplicateCode = await Region.findOne({
      districtId,
      code: code.toUpperCase(),
    });

    if (duplicateCode) {
      throw new ApiError(
        409,
        "Region with this code already exists in this district",
      );
    }
  }

  const region = await Region.create({
    districtId,
    name,
    code: code ? code.toUpperCase() : undefined,
    description: description || "",
    isActive,
    createdBy: req.user._id,
  });

  await District.findByIdAndUpdate(
    districtId,
    {
      $addToSet: { regions: region._id },
    },
    { new: true },
  );

  return res
    .status(201)
    .json(new ApiResponse(201, region, "Region created successfully"));
});

export const getAllRegions = asyncHandler(async (req, res) => {
  const regions = await Region.find({ isActive: true })
    .populate("districtId", "districtName pinCode state")
    .sort({ name: 1 });

  return res
    .status(200)
    .json(new ApiResponse(200, regions, "Regions retrieved successfully"));
});

export const getRegionById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const region = await Region.findOne({ _id: id, isActive: true }).populate(
    "districtId",
    "districtName pinCode state",
  );

  if (!region) {
    throw new ApiError(404, "Region not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, region, "Region retrieved successfully"));
});

export const getRegionsByDistrict = asyncHandler(async (req, res) => {
  const { districtId } = req.params;

  const district = await District.findById(districtId);

  if (!district) {
    throw new ApiError(404, "District not found");
  }

  const regions = await Region.find({ districtId, isActive: true })
    .populate("districtId", "districtName pinCode state")
    .sort({ name: 1 });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        regions,
        "Regions for district retrieved successfully",
      ),
    );
});

export const updateRegion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, code, description, isActive } = req.body;

  const region = await Region.findOne({ _id: id, isActive: true });

  if (!region) {
    throw new ApiError(404, "Region not found");
  }

  if (name && name !== region.name) {
    const duplicateName = await Region.findOne({
      districtId: region.districtId,
      name,
    });

    if (
      duplicateName &&
      duplicateName._id.toString() !== region._id.toString()
    ) {
      throw new ApiError(
        409,
        "Region with this name already exists in this district",
      );
    }
  }

  if (code && code.toUpperCase() !== (region.code || "")) {
    const duplicateCode = await Region.findOne({
      districtId: region.districtId,
      code: code.toUpperCase(),
    });

    if (
      duplicateCode &&
      duplicateCode._id.toString() !== region._id.toString()
    ) {
      throw new ApiError(
        409,
        "Region with this code already exists in this district",
      );
    }
  }

  const updatedRegion = await Region.findByIdAndUpdate(
    id,
    {
      ...(name && { name }),
      ...(code && { code: code.toUpperCase() }),
      ...(typeof description === "string" && { description }),
      ...(typeof isActive === "boolean" && { isActive }),
      updatedBy: req.user._id,
    },
    { new: true, runValidators: true },
  ).populate("districtId", "districtName pinCode state");

  return res
    .status(200)
    .json(new ApiResponse(200, updatedRegion, "Region updated successfully"));
});

export const deleteRegion = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const region = await Region.findOneAndUpdate(
    { _id: id, isActive: true },
    {
      isActive: false,
      updatedBy: req.user._id,
    },
    { new: true },
  );

  if (!region) {
    throw new ApiError(404, "Region not found");
  }

  //   await District.findByIdAndUpdate(
  //     region.districtId,
  //     {
  //       $pull: { regions: region._id },
  //     },
  //     { new: true },
  //   );

  return res
    .status(200)
    .json(new ApiResponse(200, region, "Region deleted successfully"));
});
