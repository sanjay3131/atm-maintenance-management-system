import { Router } from "express";
import { verifyAccessToken } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/role.middleware.js";
import { validateRequest } from "../../middlewares/validate.middleware.js";
import {
  createPublicHolidaySchema,
  publicHolidayIdParamsSchema,
  publicHolidayListQuerySchema,
  updatePublicHolidaySchema,
} from "./publicHoliday.validation.js";
import {
  getPublicHolidays,
  patchPublicHoliday,
  postPublicHoliday,
  removePublicHoliday,
} from "./publicHoliday.controller.js";

const router = Router();

router.use(verifyAccessToken, authorizeRoles("admin", "superAdmin"));

router.get(
  "/",
  validateRequest(publicHolidayListQuerySchema, "query"),
  getPublicHolidays,
);
router.post("/", validateRequest(createPublicHolidaySchema), postPublicHoliday);
router.patch(
  "/:holidayId",
  validateRequest(publicHolidayIdParamsSchema, "params"),
  validateRequest(updatePublicHolidaySchema),
  patchPublicHoliday,
);
router.delete(
  "/:holidayId",
  validateRequest(publicHolidayIdParamsSchema, "params"),
  removePublicHoliday,
);

export default router;
