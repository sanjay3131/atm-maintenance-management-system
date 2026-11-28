import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import { getRecurringCleaningPlanHistory } from "./cleaningHistory.service.js";

export const getRecurringCleaningPlanCleaningHistory = asyncHandler(
  async (req, res) => {
    const result = await getRecurringCleaningPlanHistory({
      planId: req.validatedParams.planId,
      ...req.validatedQuery,
    });

    return res
      .status(200)
      .json(new ApiResponse(200, result, "Recurring cleaning history fetched"));
  },
);
