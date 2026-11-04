import ApiError from "../../utils/ApiError.js";
import PublicHoliday from "./publicHoliday.model.js";

const ADMIN_ROLES = new Set(["admin", "superAdmin"]);

const requireAdmin = (actor) => {
  if (!actor?._id || !ADMIN_ROLES.has(actor.userType)) {
    throw new ApiError(403, "You do not have permission to manage public holidays");
  }
};

const isDuplicateKeyError = (error) => error?.code === 11000;
const throwHolidayDateConflict = (error) => {
  if (isDuplicateKeyError(error)) {
    throw new ApiError(409, "A public holiday already exists for this date");
  }
  throw error;
};

export const listPublicHolidays = async (actor, filters) => {
  requireAdmin(actor);
  const date = {};
  if (filters.fromDate) date.$gte = filters.fromDate;
  if (filters.toDate) date.$lte = filters.toDate;
  const query = Object.keys(date).length ? { date } : {};
  const skip = (filters.page - 1) * filters.limit;
  const [holidays, total] = await Promise.all([
    PublicHoliday.find(query)
      .sort({ date: 1, _id: 1 })
      .skip(skip)
      .limit(filters.limit),
    PublicHoliday.countDocuments(query),
  ]);

  return {
    holidays,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.ceil(total / filters.limit),
    },
  };
};

export const createPublicHoliday = async (actor, values) => {
  requireAdmin(actor);
  if (await PublicHoliday.findOne({ date: values.date })) {
    throw new ApiError(409, "A public holiday already exists for this date");
  }
  try {
    return await PublicHoliday.create({
      ...values,
      description: values.description ?? "",
      createdBy: actor._id,
      updatedBy: actor._id,
    });
  } catch (error) {
    throwHolidayDateConflict(error);
  }
};

export const updatePublicHoliday = async (actor, holidayId, values) => {
  requireAdmin(actor);
  const holiday = await PublicHoliday.findById(holidayId);
  if (!holiday) throw new ApiError(404, "Public holiday not found");

  if (
    values.date &&
    (await PublicHoliday.findOne({
      date: values.date,
      _id: { $ne: holiday._id },
    }))
  ) {
    throw new ApiError(409, "A public holiday already exists for this date");
  }

  Object.assign(holiday, values, { updatedBy: actor._id });
  try {
    await holiday.save();
    return holiday;
  } catch (error) {
    throwHolidayDateConflict(error);
  }
};

export const deletePublicHoliday = async (actor, holidayId) => {
  requireAdmin(actor);
  const holiday = await PublicHoliday.findByIdAndDelete(holidayId);
  if (!holiday) throw new ApiError(404, "Public holiday not found");
  return { id: String(holiday._id), date: holiday.date };
};
