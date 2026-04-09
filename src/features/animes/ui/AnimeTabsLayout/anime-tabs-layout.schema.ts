import { z } from 'zod';

export const AnimeTabsLayoutSchema = z.object({
  label: z.string().optional(),
});
