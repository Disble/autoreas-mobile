import { z } from 'zod';

export const AppRootLayoutSchema = z.object({
  label: z.string().optional(),
});
