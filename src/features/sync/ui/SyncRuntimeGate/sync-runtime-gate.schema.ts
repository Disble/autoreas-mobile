import { z } from 'zod';

/** Validates sync runtime gate schema payloads at runtime. */

export const SyncRuntimeGateSchema = z.object({
  label: z.string().optional(),
});
