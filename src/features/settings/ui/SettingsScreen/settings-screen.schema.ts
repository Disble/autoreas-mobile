import { z } from 'zod';

export const SettingsScreenSchema = z.object({
  label: z.string().optional(),
});
