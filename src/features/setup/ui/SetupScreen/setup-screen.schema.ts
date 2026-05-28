import { z } from 'zod';
import { SETUP_DEEP_LINK_SUPPORTED_VERSION } from './setup-screen.constants';

const setupTextSchema = z.string().trim().min(1);

const setupPortSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .refine((value) => {
    const port = Number.parseInt(value, 10);
    return port >= 1 && port <= 65535;
  });

export const SetupScreenFormSchema = z.object({
  ip: setupTextSchema,
  port: setupPortSchema,
  token: setupTextSchema,
});

export const SetupPairingPayloadSchema = SetupScreenFormSchema.extend({
  version: z.literal(SETUP_DEEP_LINK_SUPPORTED_VERSION),
});
