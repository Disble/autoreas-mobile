/**
 * Compile-time contract for the sync runtime status counters. Every counter key is declared exactly
 * once, in the `SyncCountKey`/`SyncNullableCountKey` unions in `sync-runtime-status.types.ts`, and
 * reaches the snapshot through `Readonly<Record<...>>` and the patch through `Partial<...>`.
 *
 * The `@ts-expect-error` assertions ARE the test: the value checks keep this suite honest at
 * runtime, but `tsc` is what fails when the contract drifts. They exist because the single-list
 * refactor moved the "always a plain number" and "may be `null`" split into the unions alone:
 * nothing else in the repository would notice if the two unions were merged, since `null` and `0`
 * both satisfy `DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT`.
 */
import { DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT } from '../../../../src/features/sync/sync-runtime-status.constants';
import type {
  SyncRuntimeStatusPatch,
  SyncRuntimeStatusSnapshot,
} from '../../../../src/features/sync/sync-runtime-status.types';

describe('sync runtime status counter contract (compile-time)', () => {
  it('keeps the always-measured counters required and non-nullable on the snapshot', () => {
    // @ts-expect-error -- the streak is required: the bookkeeping write always measured it.
    const streak: SyncRuntimeStatusSnapshot['consecutiveUnclosedCycles'] = undefined;

    // @ts-expect-error -- a plain counter is a `number`; `null` means "never measured" and is not it.
    const failedCheckpoints: SyncRuntimeStatusSnapshot['lastFailedCheckpointCount'] = null;

    // @ts-expect-error -- the key set is closed: a counter nobody declared is not part of the row.
    const unknownCounter: SyncRuntimeStatusSnapshot['lastNeverMeasuredCount'] = 0;

    const withoutPendingCount = { ...DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT } as Omit<
      SyncRuntimeStatusSnapshot,
      'lastPendingRowCount'
    >;
    // @ts-expect-error -- a nullable counter is still a required KEY of the snapshot, not an optional one.
    const asSnapshot: SyncRuntimeStatusSnapshot = withoutPendingCount;

    expect(streak).toBeUndefined();
    expect(failedCheckpoints).toBeNull();
    expect(unknownCounter).toBe(0);
    expect(asSnapshot.lastPendingRowCount).toBeNull();
  });

  it('accepts `null`, `undefined`, and omission for a nullable counter on the patch', () => {
    const cleared: SyncRuntimeStatusPatch = { lastDiagnosticsDiscardedCount: null };
    const unmentioned: SyncRuntimeStatusPatch = { lastDiagnosticsDiscardedCount: undefined };
    const omitted: SyncRuntimeStatusPatch = { lastSuccessAt: 1 };

    // @ts-expect-error -- a nullable counter patch takes a number or an explicit `null`, not free text.
    const wrongType: SyncRuntimeStatusPatch = { lastPendingRowCount: 'many' };

    // @ts-expect-error -- the plain counters keep their `number` contract in the optional view too.
    const clearedStreak: SyncRuntimeStatusPatch = { consecutiveUnclosedCycles: null };

    expect(cleared.lastDiagnosticsDiscardedCount).toBeNull();
    expect(unmentioned.lastDiagnosticsDiscardedCount).toBeUndefined();
    expect(omitted.lastDiagnosticsDiscardedCount).toBeUndefined();
    expect(wrongType.lastPendingRowCount).toBe('many');
    expect(clearedStreak.consecutiveUnclosedCycles).toBeNull();
  });
});
