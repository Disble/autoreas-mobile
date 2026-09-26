import { buildBackgroundSyncSection } from '../../../../src/features/settings/ui/SettingsScreen/settings-screen.helpers';
import { DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT } from '../../../../src/features/sync/sync-runtime-status.constants';
import type { SyncRuntimeStatusSnapshot } from '../../../../src/features/sync/sync-runtime-status.types';

/**
 * N2b cases for the cumulative capacity-shed counter, kept in a NEW sibling file because
 * `settings-screen.helpers.test.ts` already sits at 469 lines (CLAUDE.md rule 5, the 500-line
 * ceiling). The `shedCount` input is deliberately SEPARATE from the persisted snapshot counters:
 * it is read live from the outbox store's own counter table, never written into a status row.
 */

/** A configured, registered snapshot so the metric-tile branch of the helper is the one under test. */
const REGISTERED_SNAPSHOT: SyncRuntimeStatusSnapshot = {
  ...DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT,
  registrationStatus: 'registered',
  isBackgroundTaskRegistered: true,
};

describe('settings-screen capacity-shed tile', () => {
  it('omits the tile when the count is null (an unreadable counter is absent, never zero)', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: REGISTERED_SNAPSHOT,
      shedCount: null,
    });

    expect(section.tiles.map((tile) => tile.id)).not.toContain('diagnosticsCapacityShedCount');
  });

  it('omits the tile when the caller never supplies a count (backward-compatible callers)', () => {
    // The field is optional precisely so the existing `buildBackgroundSyncSection({ isConfigured,
    // snapshot })` call sites keep compiling; an omitted input means the same thing as `null`.
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: REGISTERED_SNAPSHOT,
    });

    expect(section.tiles.map((tile) => tile.id)).not.toContain('diagnosticsCapacityShedCount');
  });

  it('renders a measured zero as a neutral tile, not as absence', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: REGISTERED_SNAPSHOT,
      shedCount: 0,
    });

    const tile = section.tiles.find((candidate) => candidate.id === 'diagnosticsCapacityShedCount');

    expect(tile).toMatchObject({ value: '0', tone: 'default' });
  });

  it('renders a positive cumulative count as a danger tile with its own distinct label', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: {
        ...REGISTERED_SNAPSHOT,
        lastDiagnosticsDiscardedCount: 2,
      },
      shedCount: 7,
    });

    const tileMap = Object.fromEntries(section.tiles.map((tile) => [tile.id, tile]));

    expect(tileMap.diagnosticsCapacityShedCount).toMatchObject({
      label: 'Diagnósticos perdidos por capacidad',
      value: '7',
      tone: 'danger',
    });
    // The per-cycle BRIDGE refusals and the cap's own cumulative drops are different facts and
    // must never read alike.
    expect(tileMap.diagnosticsCapacityShedCount.label).not.toBe(
      tileMap.diagnosticsDiscardedCount.label,
    );
  });
});
