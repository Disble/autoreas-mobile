import { z } from 'zod';

/**
 * Validates one persisted cover manifest entry at runtime. Not exported: only `CoverManifestSchema`
 * (which embeds it) is a public contract. `sourceKey` is optional so a legacy v1 entry persisted
 * before it existed still parses -- see `CoverManifestEntry`'s doc comment.
 */
const CoverManifestEntrySchema = z.object({
  status: z.enum(['image', 'absent', 'unknown', 'transient']),
  fileName: z.string().nullable(),
  etag: z.string().nullable(),
  checkedAt: z.number().nullable(),
  nextAttemptAt: z.number(),
  failureCount: z.number().int().nonnegative(),
  sourceKey: z.string().nullable().optional(),
});

/** Validates the persisted v1 cover manifest at runtime. */
export const CoverManifestSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), CoverManifestEntrySchema),
});
