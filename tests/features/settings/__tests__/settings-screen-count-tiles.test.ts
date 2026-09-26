import { CONVERGENCE_COUNT_TILE_DESCRIPTORS } from '../../../../src/features/settings/ui/SettingsScreen/settings-screen.constants';
import { buildBackgroundSyncSection } from '../../../../src/features/settings/ui/SettingsScreen/settings-screen.helpers';
import type {
  ConvergenceCountTileField,
  MetricTile,
} from '../../../../src/features/settings/ui/SettingsScreen/settings-screen.types';
import { DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT } from '../../../../src/features/sync/sync-runtime-status.constants';
import type { SyncRuntimeStatusSnapshot } from '../../../../src/features/sync/sync-runtime-status.types';

/**
 * D2 cases for the nine count-only convergence tiles, kept in a NEW sibling file because
 * `settings-screen.helpers.test.ts` already sits at 469 lines (CLAUDE.md rule 5, the 500-line
 * ceiling).
 *
 * Nine structurally identical `pushCountTile` calls were one fallow clone group (`dup:0bfbb1bf`),
 * so they became one descriptor table driven by one loop. These cases pin what that refactor must
 * NOT change: the exact render order, Spanish label, icon and escalation tone of every tile, a
 * `null` counter meaning "never measured" (Decision 7, tile omitted rather than zero-filled), a
 * measured `0` rendering as a neutral tile, and the oldest-age / pending-row neighbours that stay
 * outside the table.
 */

/** The nine count tiles in render order. The descriptor table and the rendered card must agree. */
const COUNT_TILE_IDS: readonly string[] = [
  'diagnosticsDiscardedCount',
  'diagnosticsFailedRemovalCount',
  'diagnosticsUndeliverableCount',
  'diagnosticsUnclassifiedCount',
  'diagnosticsReapedCount',
  'outboxFailedWriteCount',
  'deadLetterCount',
  'conflictExhaustedCount',
  'stuckProcessingCount',
];

/** The nine snapshot counters behind those tiles, in the same order. */
const COUNT_TILE_FIELDS: readonly ConvergenceCountTileField[] = [
  'lastDiagnosticsDiscardedCount',
  'lastDiagnosticsFailedRemovalCount',
  'lastDiagnosticsUndeliverableCount',
  'lastDiagnosticsUnclassifiedCount',
  'lastDiagnosticsReapedCount',
  'lastOutboxFailedWriteCount',
  'lastDeadLetterCount',
  'lastConflictExhaustedCount',
  'lastStuckProcessingCount',
];

/** The Spanish copy contract per tile id; the descriptor table is only one implementation of it. */
const COUNT_TILE_LABELS: Readonly<Record<string, string>> = {
  diagnosticsDiscardedCount: 'Diagnósticos descartados',
  diagnosticsFailedRemovalCount: 'Diagnósticos a reintentar',
  diagnosticsUndeliverableCount: 'Diagnósticos destruidos por declaración',
  diagnosticsUnclassifiedCount: 'Diagnósticos sin clasificar',
  diagnosticsReapedCount: 'Diagnósticos retirados por antigüedad',
  outboxFailedWriteCount: 'Escrituras de outbox fallidas',
  deadLetterCount: 'Operaciones bloqueadas',
  conflictExhaustedCount: 'Conflictos sin resolver',
  stuckProcessingCount: 'Operaciones atascadas',
};

/** One distinct positive value per count tile, so every tile renders and escalates its tone. */
const MEASURED_COUNTERS: Readonly<Record<ConvergenceCountTileField, number>> = {
  lastDiagnosticsDiscardedCount: 1,
  lastDiagnosticsFailedRemovalCount: 2,
  lastDiagnosticsUndeliverableCount: 3,
  lastDiagnosticsUnclassifiedCount: 4,
  lastDiagnosticsReapedCount: 5,
  lastOutboxFailedWriteCount: 6,
  lastDeadLetterCount: 7,
  lastConflictExhaustedCount: 8,
  lastStuckProcessingCount: 9,
};

/** The all-zero counter set: measured, so these tiles render neutral instead of disappearing. */
const ZERO_COUNTERS: Readonly<Record<ConvergenceCountTileField, number>> = {
  lastDiagnosticsDiscardedCount: 0,
  lastDiagnosticsFailedRemovalCount: 0,
  lastDiagnosticsUndeliverableCount: 0,
  lastDiagnosticsUnclassifiedCount: 0,
  lastDiagnosticsReapedCount: 0,
  lastOutboxFailedWriteCount: 0,
  lastDeadLetterCount: 0,
  lastConflictExhaustedCount: 0,
  lastStuckProcessingCount: 0,
};

/**
 * A registered snapshot with every count tile measured, plus the two derived neighbours the table
 * deliberately does NOT own: the oldest pending age and the true backlog depth.
 */
const MEASURED_SNAPSHOT: SyncRuntimeStatusSnapshot = {
  ...DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT,
  registrationStatus: 'registered',
  isBackgroundTaskRegistered: true,
  ...MEASURED_COUNTERS,
  lastOldestPendingAgeMs: 125_000,
  lastPendingRowCount: 210,
};

/** Derives the rendered section once, keyed by tile id, for direct tile assertions. */
function renderTileMap(snapshot: SyncRuntimeStatusSnapshot): Record<string, MetricTile> {
  const tiles = buildBackgroundSyncSection({ isConfigured: true, snapshot }).tiles;

  return Object.fromEntries(tiles.map((tile) => [tile.id, tile]));
}

/** The same measured snapshot with exactly one counter left unmeasured (`null`). */
function buildSnapshotWithCounterCleared(
  field: ConvergenceCountTileField,
): SyncRuntimeStatusSnapshot {
  const counters: Record<ConvergenceCountTileField, number | null> = { ...MEASURED_COUNTERS };
  counters[field] = null;

  return { ...MEASURED_SNAPSHOT, ...counters };
}

describe('background sync count tiles', () => {
  it('renders the nine measured tiles in table order, ahead of the derived age and backlog tiles', () => {
    const tileIds = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: MEASURED_SNAPSHOT,
    }).tiles.map((tile) => tile.id);
    const firstCountTileIndex = tileIds.indexOf(COUNT_TILE_IDS[0]);

    expect(tileIds.slice(firstCountTileIndex, firstCountTileIndex + COUNT_TILE_IDS.length)).toEqual(
      COUNT_TILE_IDS,
    );
    // The two neighbours are not table entries: the age is a formatted duration and the row count
    // carries a derived `hasMore` suffix, so both stay bespoke.
    expect(tileIds[firstCountTileIndex + COUNT_TILE_IDS.length]).toBe('oldestPendingAgeMs');
    expect(tileIds[firstCountTileIndex + COUNT_TILE_IDS.length + 1]).toBe('pendingRowCount');
  });

  it('renders each measured tile with its descriptor copy, icon, value and non-zero tone', () => {
    const tileMap = renderTileMap(MEASURED_SNAPSHOT);

    for (const descriptor of CONVERGENCE_COUNT_TILE_DESCRIPTORS) {
      expect(tileMap[descriptor.id]).toMatchObject({
        label: descriptor.label,
        iconName: descriptor.iconName,
        value: String(MEASURED_COUNTERS[descriptor.snapshotField]),
        tone: descriptor.nonZeroTone,
      });
    }
  });

  it('keeps the nine Spanish labels distinct and unchanged', () => {
    const tileMap = renderTileMap(MEASURED_SNAPSHOT);
    const labels = COUNT_TILE_IDS.map((id) => tileMap[id].label);

    expect(labels).toEqual(COUNT_TILE_IDS.map((id) => COUNT_TILE_LABELS[id]));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('renders a measured zero as a neutral tile instead of omitting it', () => {
    const tileMap = renderTileMap({ ...MEASURED_SNAPSHOT, ...ZERO_COUNTERS });

    for (const id of COUNT_TILE_IDS) {
      expect(tileMap[id]).toMatchObject({ value: '0', tone: 'default' });
    }
  });

  it('omits exactly the tile whose own counter was never measured', () => {
    for (const descriptor of CONVERGENCE_COUNT_TILE_DESCRIPTORS) {
      const snapshot = buildSnapshotWithCounterCleared(descriptor.snapshotField);
      const tileIds = buildBackgroundSyncSection({
        isConfigured: true,
        snapshot,
      }).tiles.map((tile) => tile.id);
      const missingCountTileIds = COUNT_TILE_IDS.filter((id) => !tileIds.includes(id));

      expect(missingCountTileIds).toEqual([descriptor.id]);
    }
  });

  it('leaves the age and backlog tiles out when their own counters were never measured', () => {
    const tileIds = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: { ...MEASURED_SNAPSHOT, lastOldestPendingAgeMs: null, lastPendingRowCount: null },
    }).tiles.map((tile) => tile.id);

    expect(tileIds).not.toContain('oldestPendingAgeMs');
    expect(tileIds).not.toContain('pendingRowCount');
    expect(tileIds).toEqual(expect.arrayContaining([...COUNT_TILE_IDS]));
  });
});

describe('CONVERGENCE_COUNT_TILE_DESCRIPTORS', () => {
  it('lists the nine count tiles in render order', () => {
    expect(CONVERGENCE_COUNT_TILE_DESCRIPTORS.map((descriptor) => descriptor.id)).toEqual(
      COUNT_TILE_IDS,
    );
  });

  it('binds each tile to its own snapshot counter', () => {
    expect(
      CONVERGENCE_COUNT_TILE_DESCRIPTORS.map((descriptor) => descriptor.snapshotField),
    ).toEqual(COUNT_TILE_FIELDS);
    expect(new Set(COUNT_TILE_FIELDS).size).toBe(COUNT_TILE_FIELDS.length);
  });
});
