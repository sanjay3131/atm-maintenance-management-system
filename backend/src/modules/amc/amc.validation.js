import { z } from "zod";

export const completeAMCSchema = z.object({
  gps: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().nonnegative().optional(),
  }),
  remarks: z.string().max(1000).optional(),
});
