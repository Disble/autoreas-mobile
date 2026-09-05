import { z } from 'zod';

/**
 * Builds a zod schema that normalizes a nullish array field to an empty array, mirroring the
 * bridge's tolerant top-level collection contract (`applied_operations`, `bridge_changes`).
 */
export const ReconcileArrayFallback = <TSchema extends z.ZodTypeAny>(itemSchema: TSchema) =>
  z.array(itemSchema).nullish().transform((value) => value ?? []);
