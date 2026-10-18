import * as Crypto from 'expo-crypto';
import type { RequestIdSequence } from './request-id.types';

/**
 * Starts the request numbering of one sync cycle. Every call is a new cycle: a new id, and a count
 * that starts again at 1. The id is a lowercase UUID (36 chars), so `<cycleId>:<n>` stays inside
 * the bridge's `^[A-Za-z0-9._-]{1,48}:[0-9]{1,9}$` contract.
 */
export function createRequestIdSequence(
  cycleId: string = Crypto.randomUUID().toLowerCase(),
): RequestIdSequence {
  let issued = 0;

  return {
    cycleId,
    next: () => {
      issued += 1;

      return `${cycleId}:${issued}`;
    },
  };
}
