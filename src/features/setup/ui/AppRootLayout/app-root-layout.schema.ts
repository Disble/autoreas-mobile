import { z } from 'zod';

/** Validates app root layout schema payloads at runtime. */

export const AppRootLayoutSchema = z.object({
  label: z.string().optional(),
});
