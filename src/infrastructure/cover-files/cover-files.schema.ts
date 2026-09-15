import { z } from 'zod';

/** Validates one persisted cover manifest entry at runtime. Not exported: only `CoverManifestSchema` (which embeds it) is a public contract. */
const CoverManifestEntrySchema = z.object({
  status: z.enum(['image', 'absent', 'unknown', 'transient']),
  fileName: z.string().nullable(),
  etag: z.string().nullable(),
  checkedAt: z.number().nullable(),
  nextAttemptAt: z.number(),
  failureCount: z.number().int().nonnegative(),
});

/** Validates the persisted v1 cover manifest at runtime. */
export const CoverManifestSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), CoverManifestEntrySchema),
});
