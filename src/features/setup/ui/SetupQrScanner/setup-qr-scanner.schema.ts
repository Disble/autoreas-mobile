import { z } from 'zod';

export const SetupQrScannerSchema = z.object({
  data: z.string().trim().min(1),
});
