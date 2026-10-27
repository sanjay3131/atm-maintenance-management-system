import { z } from "zod";

export const NOTIFICATION_DEFAULT_LIMIT = 20;
export const NOTIFICATION_MAX_LIMIT = 100;

const positiveInteger = (name, max) =>
  z
    .string()
    .regex(/^[1-9]\d{0,8}$/, `${name} must be a positive integer`)
    .transform(Number)
    .refine((value) => max === undefined || value <= max, {
      message: `${name} must not exceed ${max}`,
    });

export const notificationListQuerySchema = z.object({
  page: positiveInteger("page").default(1),
  limit: positiveInteger("limit", NOTIFICATION_MAX_LIMIT).default(
    NOTIFICATION_DEFAULT_LIMIT,
  ),
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const notificationIdParamsSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid notification ID"),
});
