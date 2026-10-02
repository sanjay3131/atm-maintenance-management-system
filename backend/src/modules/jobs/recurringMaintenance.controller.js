import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import {
  createRecurringMaintenancePlan,
  generateRecurringJobs,
  getRecurringMaintenancePlans,
  updateRecurringMaintenancePlan,
} from "./recurringMaintenance.service.js";

export const listRecurringMaintenancePlans = asyncHandler(async (req, res) => {
  const plans = await getRecurringMaintenancePlans();
  return res
    .status(200)
    .json(new ApiResponse(200, plans, "Recurring maintenance plans fetched"));
});

export const createRecurringMaintenancePlanController = asyncHandler(
  async (req, res) => {
    const plan = await createRecurringMaintenancePlan(
      req.body,
      req.user._id,
    );
    return res
      .status(201)
      .json(new ApiResponse(201, plan, "Recurring maintenance plan created"));
  },
);

export const updateRecurringMaintenancePlanController = asyncHandler(
  async (req, res) => {
    if (!/^[a-fA-F0-9]{24}$/.test(req.params.planId)) {
      throw new ApiError(400, "Invalid maintenance plan ID");
    }

    const plan = await updateRecurringMaintenancePlan(
      req.params.planId,
      req.body,
      req.user._id,
    );
    if (!plan) throw new ApiError(404, "Recurring maintenance plan not found");

    return res
      .status(200)
      .json(new ApiResponse(200, plan, "Recurring maintenance plan updated"));
  },
);

export const triggerRecurringJobGeneration = asyncHandler(
  async (req, res) => {
    const summary = await generateRecurringJobs({ createdBy: req.user._id });
    return res
      .status(200)
      .json(new ApiResponse(200, summary, "Recurring job generation completed"));
  },
);
