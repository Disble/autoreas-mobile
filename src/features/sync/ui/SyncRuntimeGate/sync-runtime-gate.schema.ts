import { z } from 'zod';

export const SyncRuntimeGateSchema = z.object({
  label: z.string().optional(),
});
