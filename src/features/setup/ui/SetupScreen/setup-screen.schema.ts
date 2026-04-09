import { z } from 'zod';

export const SetupScreenSchema = z.object({
  label: z.string().optional(),
});
