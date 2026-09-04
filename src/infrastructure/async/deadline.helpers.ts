import { DeadlineExceededError } from './deadline.errors';
import type { WithDeadlineParams } from './deadline.types';

/**
 * Bounds the CALLER's view of an operation. On expiry the returned promise rejects with a
 * `DeadlineExceededError`; the operation itself keeps running, because JavaScript cannot cancel
 * an in-flight promise and pretending otherwise would be worse than saying so.
 *
 * The timer is cleared on EVERY path. A leaked timer per call keeps the event loop alive, which
 * in a background job means holding the host runtime open long after the work is done. That is
 * the one guard here a test can prove by deleting it, and the mutation cycle confirms it does.
 *
 * A note on the swallowing `.catch()` below, because an earlier version of this comment
 * overstated it. `Promise.race` subscribes to every input promise, so a loser that rejects after
 * the race settles already HAS a handler and never surfaces as an `unhandledRejection`. Deleting
 * the `.catch()` changes no observable behaviour -- the mutation cycle showed the test asserting
 * "no unhandled rejection" still passes without it. It stays as cheap insurance against a
 * refactor that stops racing, and is documented as such so nobody mistakes it for a proof.
 */
export async function withDeadline<TValue>({
  operation,
  timeoutMs,
  label,
}: WithDeadlineParams<TValue>): Promise<TValue> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = operation();

  // Defence in depth only -- see the note above. `Promise.race` already handles this promise.
  settled.catch(() => undefined);

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new DeadlineExceededError(label, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([settled, deadline]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
