import { z } from 'zod';
import { RESET_INTENT_REASONS } from './recovery.constants';

/**
 * Validates the durable reset intent persisted before any destructive step.
 *
 * The schema is strict on purpose. A record carrying any key beyond the reason code and the
 * timestamp is a foreign or corrupted payload, not a legitimate intent, and must be treated as
 * absent rather than trusted. Strictness is also what keeps personal data out of the record:
 * there is nowhere for it to live, and an extra key is a validation failure instead of a silent
 * pass that would re-persist it.
 */
export const ResetIntentSchema = z.strictObject({
  reason: z.enum(RESET_INTENT_REASONS),
  requestedAt: z.number().int().nonnegative(),
});

/** Defines the durable reset-intent record: a reason code and the moment it was requested. */
export type ResetIntent = z.infer<typeof ResetIntentSchema>;
