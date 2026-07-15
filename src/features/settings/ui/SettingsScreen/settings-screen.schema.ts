import { z } from 'zod';

/** Validates settings screen schema payloads at runtime. */

export const SettingsScreenSchema = z.object({
  label: z.string().optional(),
});
