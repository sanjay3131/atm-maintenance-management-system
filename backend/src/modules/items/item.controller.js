import mongoose from "mongoose";
import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import Item from "./item.model.js";

const normalizeName = (itemName) => itemName.trim().toLowerCase();

const throwDuplicateNameError = (error) => {
  if (error?.code === 11000) {
    throw new ApiError(409, "An Item with this name already exists");
  }
  throw error;
};

const findItemById = async (id) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(400, "Invalid Item ID");
  }

  const item = await Item.findById(id);
  if (!item) throw new ApiError(404, "Item not found");
  return item;
};

export const createItem = asyncHandler(async (req, res) => {
  const { itemName, unit, currentUnitCost, isActive } = req.body;
  try {
    const item = await Item.create({
      itemName: itemName.trim(),
      normalizedName: normalizeName(itemName),
      unit: unit.trim(),
      currentUnitCost,
      ...(isActive === undefined ? {} : { isActive }),
      createdBy: req.user._id,
    });

    return res
      .status(201)
      .json(new ApiResponse(201, item, "Item created successfully"));
  } catch (error) {
    throwDuplicateNameError(error);
  }
});

export const getAllItems = asyncHandler(async (req, res) => {
  const { isActive } = req.query;
  const isEmployee = req.user?.userType === "employee";
  if (
    !isEmployee &&
    isActive !== undefined &&
    isActive !== "true" &&
    isActive !== "false"
  ) {
    throw new ApiError(400, "isActive must be true or false");
  }

  const filter = isEmployee
    ? { isActive: true }
    : isActive === undefined
      ? {}
      : { isActive: isActive === "true" };
  const projection = isEmployee
    ? "_id itemName unit isActive"
    : "-normalizedName";
  const items = await Item.find(filter)
    .select(projection)
    .sort({ itemName: 1 });

  return res
    .status(200)
    .json(new ApiResponse(200, items, "Items fetched successfully"));
});

export const getItemById = asyncHandler(async (req, res) => {
  const item = await findItemById(req.params.id);
  return res
    .status(200)
    .json(new ApiResponse(200, item, "Item fetched successfully"));
});

export const updateItem = asyncHandler(async (req, res) => {
  const item = await findItemById(req.params.id);
  const { itemName, unit, currentUnitCost, isActive } = req.body;

  if (itemName !== undefined) {
    item.itemName = itemName.trim();
    item.normalizedName = normalizeName(itemName);
  }
  if (unit !== undefined) item.unit = unit.trim();
  if (currentUnitCost !== undefined) item.currentUnitCost = currentUnitCost;
  if (isActive !== undefined) item.isActive = isActive;
  item.updatedBy = req.user._id;

  try {
    await item.save();
  } catch (error) {
    throwDuplicateNameError(error);
  }

  return res
    .status(200)
    .json(new ApiResponse(200, item, "Item updated successfully"));
});
