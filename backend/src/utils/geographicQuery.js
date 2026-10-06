import mongoose from "mongoose";
import ApiError from "./ApiError.js";

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export function buildATMGeographicQuery({
  districtId,
  regionId,
  bankId,
} = {}) {
  const query = { isDeleted: false };
  const scope = { districtId, regionId, bankId };

  for (const [field, value] of Object.entries(scope)) {
    if (value === undefined || value === "") continue;
    if (typeof value !== "string" || !OBJECT_ID_PATTERN.test(value)) {
      throw new ApiError(400, `Invalid ${field}`);
    }
    query[field] = new mongoose.Types.ObjectId(value);
  }

  if (!query.districtId && !query.regionId) {
    throw new ApiError(400, "districtId or regionId is required");
  }

  return query;
}

export function parsePagination(pageValue = "1", limitValue = "10") {
  if (typeof pageValue !== "string" || typeof limitValue !== "string") {
    throw new ApiError(400, "Invalid pagination parameters");
  }
  const page = Number(pageValue);
  const limit = Number(limitValue);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new ApiError(400, "Invalid pagination parameters");
  }

  return { page, limit, skip: (page - 1) * limit };
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
