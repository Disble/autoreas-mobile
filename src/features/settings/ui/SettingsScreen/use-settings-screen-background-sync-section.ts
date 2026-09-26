import { useEffect, useMemo, useState } from 'react';
import { useOptionalSQLiteContext } from '../../../../infrastructure/db/native-runtime/native-runtime.helpers';
import { syncDiagnosticsOutboxStore } from '../../../../infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants';
import { useBackgroundSyncStatus } from '../../use-background-sync-status';
import { buildBackgroundSyncSection } from './settings-screen.helpers';
import type { BackgroundSyncSection } from './settings-screen.types';

/**
 * Resolves the background sync status snapshot and derives the presentation section the
 * Settings screen renders for it. Extracted as a facade hook (per the project's Facade Hook
 * pattern) so `useSettingsScreen` stays under its complexity and line budget.
 *
 * It also owns reading the outbox store's CUMULATIVE capacity-shed counter, which must not become
 * a status column (that would need a migration and a new write per cycle). That read is NEVER
 * performed during render: the store's first `connect()` creates the outbox schema, so a read in
 * the render body would run DDL -- a side effect -- in React's render phase. The read is instead
 * SCHEDULED from an effect as a microtask, which keeps it out of the render phase AND out of the
 * effect body itself (a synchronous `setState` there is a cascading render,
 * `react-hooks/set-state-in-effect`).
 *
 * Refresh cadence stays deliberate and bounded: once at mount and again whenever the live runtime
 * snapshot CONTENT changes, which is the ONLY refresh trigger, because the store emits no change
 * event. The trigger is the snapshot's content and not its object identity on purpose: identity is
 * only stable while the React Compiler memoizes `useBackgroundSyncStatus`'s derivation, and an
 * identity-triggered read would re-read on every render of a host that failed to memoize, publish
 * again, and re-render forever. The tile can still lag behind a shed that lands after the last
 * status write, so it reports the last observed total and never claims to be a real-time counter.
 * A binary without the optional SQLite module, or an unreadable counter, yields `null` and the
 * tile is omitted rather than shown as a fabricated zero.
 *
 * While the read for the live snapshot is still pending, the tile is `null` again rather than the
 * count read for the superseded snapshot, and a read that lands after the hook unmounted (or after
 * its snapshot was superseded) is discarded instead of published.
 */
export function useSettingsScreenBackgroundSyncSection(
  isConfigured: boolean,
): BackgroundSyncSection {
  // 1. Refs

  // 2. State
  // The last observed counter, stamped with the inputs it was read for, so a render can tell a
  // read that belongs to the live snapshot from one superseded while it was pending.
  const [shedCountRead, setShedCountRead] = useState<{
    readonly rawDb: unknown;
    readonly snapshotSignature: string;
    readonly value: number | null;
  } | null>(null);

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();

  // 4. Queries/Mutations
  const { snapshot } = useBackgroundSyncStatus();

  // 5. Derived State (useMemo)
  // Content, not identity: see the hook doc for why an identity trigger can re-read forever.
  const snapshotSignature = useMemo(() => JSON.stringify(snapshot), [snapshot]);

  const backgroundSyncSection = useMemo(() => {
    // Only a read taken FOR these inputs may be rendered; anything else -- a superseded snapshot,
    // an unavailable database, a read still in flight -- renders as "not measured" rather than as
    // a count the user would read as current.
    const shedCount =
      shedCountRead !== null &&
      shedCountRead.rawDb === rawDb &&
      shedCountRead.snapshotSignature === snapshotSignature
        ? shedCountRead.value
        : null;

    return buildBackgroundSyncSection({ isConfigured, snapshot, shedCount });
  }, [isConfigured, rawDb, shedCountRead, snapshot, snapshotSignature]);

  // 6. Callbacks (useCallback calling pure helpers)

  // 7. Effects
  useEffect(() => {
    let isCancelled = false;

    if (rawDb) {
      void (async () => {
        // Scheduling the read as a microtask, rather than calling it in this body, is what keeps
        // both the DDL and the state publication out of the effect's synchronous pass.
        await Promise.resolve();

        // Cancelled before the read: nothing consumes the answer, so the store is not asked at all
        // -- no DDL for a torn-down hook, and no read a newer snapshot already superseded.
        if (isCancelled) {
          return;
        }

        // Synchronous and idempotent; it never throws, answering `null` for an unreadable counter.
        const value = syncDiagnosticsOutboxStore.readShedCount();

        // Cancelled after the read: the hook unmounted or this snapshot was superseded, so the
        // answer must not overwrite the state the live inputs own.
        if (isCancelled) {
          return;
        }

        setShedCountRead({ rawDb, snapshotSignature, value });
      })();
    }

    return () => {
      isCancelled = true;
    };
  }, [rawDb, snapshotSignature]);

  return backgroundSyncSection;
}
