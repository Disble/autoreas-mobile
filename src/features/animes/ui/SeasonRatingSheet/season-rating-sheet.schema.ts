import { z } from "zod";

export const SeasonRatingSheetSchema = z.object({
  isOpen: z.boolean(),
  animeTitle: z.string().min(1),
  bridgeRating: z.number().int().min(1).max(6).nullable(),
  pendingRating: z.number().int().min(1).max(6).nullable(),
  pendingStatus: z.enum(["pending", "failed"]).nullable(),
  pendingFailureKind: z
    .enum(["auth_repair", "conflict", "not_found", "unexpected_response", "unreachable"])
    .nullable(),
  onClose: z.custom<() => void>(),
  onSubmit: z.custom<(rating: number) => void>(),
});
