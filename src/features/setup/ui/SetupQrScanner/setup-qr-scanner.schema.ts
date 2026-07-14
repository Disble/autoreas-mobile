import { z } from 'zod';

/** Validates setup qr scanner schema payloads at runtime. */

export const SetupQrScannerSchema = z.object({
  data: z.string().trim().min(1),
});
