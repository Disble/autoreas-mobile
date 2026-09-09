import {
  buildBackgroundSyncSection,
  formatBackgroundSyncTimestamp,
} from '../../../../src/features/settings/ui/SettingsScreen/settings-screen.helpers';

/**
 * `buildSettingsSyncSummary`/`buildSettingsBridgeStatus` tests moved to the sibling
 * `settings-sync-status.helpers.test.ts` (CLAUDE.md #5, the 500-line rule).
 */

/**
 * The cycle post-mortem fields, which every snapshot in this file carries identically.
 * Extracted so a new column added to `SyncRuntimeStatusSnapshot` costs one line here instead
 * of one line in each of the six literals below -- which is how this file grew past its limit.
 */
const CYCLE_POSTMORTEM_DEFAULTS = {
  lastCycleId: null,
  lastCycleStage: null,
  lastErrorName: null,
  lastNativeErrcodeByte: null,
  lastErrorStage: null,
  consecutiveUnclosedCycles: 0,
  lastCycleStageAt: null,
  lastFailedCheckpointCount: 0,
  lastDiagnosticsDiscardedCount: null,
  lastDiagnosticsFailedRemovalCount: null,
  lastOutboxFailedWriteCount: null,
  lastDeadLetterCount: null,
  lastConflictExhaustedCount: null,
  lastStuckProcessingCount: null,
  lastOldestPendingAgeMs: null,
  lastPendingRowCount: null,
} as const;

describe('settings-screen.helpers', () => {
  it('formats timestamps into a readable deterministic UTC string', () => {
    expect(formatBackgroundSyncTimestamp(1775812200000)).toBe('2026-04-10 09:10 UTC');
  });

  it('builds a failure-oriented section for paired devices with a failed latest attempt', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: {
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775811900000,
        lastFailureMessage: 'Bridge timeout after 10s',
        lastTriggerSource: 'background_task',
        lastSyncedCount: 4,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
        isBackgroundTaskRegistered: true,
        ...CYCLE_POSTMORTEM_DEFAULTS,
      },
    });

    expect(section.statusTone).toBe('danger');
    expect(section.title).toBe('Último sync con error');
    expect(section.description).toContain('el último fallo');
    expect(section.status).toBe('Registrado');

    const tileMap = Object.fromEntries(section.tiles.map((tile) => [tile.id, tile]));

    expect(tileMap.registration).toMatchObject({
      label: 'Registro',
      value: 'Registrado',
      tone: 'success',
      iconName: 'shield-checkmark-outline',
    });
    expect(tileMap.executionMode).toMatchObject({
      label: 'Modo',
      value: 'Task best-effort',
    });
    expect(tileMap.lastAttempt).toMatchObject({
      label: 'Último intento',
      value: '2026-04-10 09:10 UTC',
      tone: 'default',
      iconName: 'time-outline',
    });
    expect(tileMap.lastSuccess).toMatchObject({
      label: 'Último éxito',
      value: '2026-04-10 09:05 UTC',
      tone: 'success',
      iconName: 'checkmark-done-outline',
    });
    expect(tileMap.lastTrigger).toMatchObject({
      label: 'Último origen',
      value: 'Task en segundo plano',
      tone: 'accent',
      iconName: 'flash-outline',
    });
    expect(tileMap.syncedCount).toMatchObject({
      label: 'Ops. confirmadas',
      value: '4',
      tone: 'default',
      iconName: 'sync-outline',
    });
    expect(tileMap.backlogReadCount).toMatchObject({
      label: 'Backlog leído',
      value: '0',
      tone: 'default',
      iconName: 'list-outline',
    });
    expect(tileMap.prunedOperationsCount).toMatchObject({
      label: 'Ops. podadas',
      value: '0',
      tone: 'default',
      iconName: 'trash-outline',
    });
    expect(tileMap.cycleActive).toMatchObject({
      label: 'Ciclo activo',
      value: 'No',
      tone: 'default',
      iconName: 'power-outline',
    });
    expect(tileMap.foregroundService).toMatchObject({
      label: 'Servicio persistente',
      value: 'Inactivo',
    });
    expect(tileMap.backgroundTask).toMatchObject({
      label: 'Task periódico',
      value: 'Registrado',
      tone: 'success',
    });
    expect(tileMap.lastFailure).toMatchObject({
      label: 'Último fallo',
      value: 'Bridge timeout after 10s',
      tone: 'danger',
      iconName: 'alert-circle-outline',
      span: 'full',
    });
  });

  it('builds a success-oriented section when the periodic task has at least one successful run', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: {
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775811900000,
        lastFailureMessage: null,
        lastTriggerSource: 'app_active',
        lastSyncedCount: 12,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
        isBackgroundTaskRegistered: true,
        ...CYCLE_POSTMORTEM_DEFAULTS,
      },
    });

    expect(section.statusTone).toBe('success');
    expect(section.title).toBe('Sync en segundo plano operativo');
    expect(section.tiles.find((tile) => tile.id === 'lastFailure')).toBeUndefined();
    expect(section.tiles.map((tile) => tile.id)).toEqual(
      expect.arrayContaining([
        'executionMode',
        'registration',
        'lastAttempt',
        'lastSuccess',
        'lastTrigger',
        'syncedCount',
        'backlogReadCount',
        'prunedOperationsCount',
        'cycleActive',
        'foregroundService',
        'backgroundTask',
        'notificationPermission',
      ]),
    );
  });

  it('builds a foreground-service oriented section for Android continuous sync mode', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: {
        registrationStatus: 'registered',
        executionMode: 'android_foreground_service',
        isForegroundServiceRunning: true,
        canShowPersistentNotification: true,
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775811900000,
        lastFailureMessage: null,
        lastTriggerSource: 'background_task',
        lastSyncedCount: 8,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
        isBackgroundTaskRegistered: true,
        ...CYCLE_POSTMORTEM_DEFAULTS,
      },
    });

    expect(section.title).toBe('Sync continuo operativo');
    expect(section.description).toContain('servicio foreground');

    const tileMap = Object.fromEntries(section.tiles.map((tile) => [tile.id, tile]));

    expect(tileMap.executionMode.value).toBe('Servicio foreground Android');
    expect(tileMap.foregroundService.value).toBe('Activo');
    // WorkManager stays visible and registered alongside the running FGS (non-exclusive registration).
    expect(tileMap.backgroundTask.value).toBe('Registrado');
    expect(tileMap.notificationPermission.value).toBe('Permitida');
  });

  it('reflects active cycle and recent pruning in tile tones', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: {
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775812200000,
        lastFailureMessage: null,
        lastTriggerSource: 'app_active',
        lastSyncedCount: 3,
        isCycleActive: true,
        lastBacklogReadCount: 150,
        lastPrunedOperationsCount: 42,
        isBackgroundTaskRegistered: false,
        ...CYCLE_POSTMORTEM_DEFAULTS,
      },
    });

    const tileMap = Object.fromEntries(section.tiles.map((tile) => [tile.id, tile]));

    expect(tileMap.cycleActive).toMatchObject({
      label: 'Ciclo activo',
      value: 'Sí',
      tone: 'accent',
      iconName: 'pulse-outline',
    });
    expect(tileMap.backlogReadCount).toMatchObject({
      label: 'Backlog leído',
      value: '150',
      tone: 'default',
      iconName: 'list-outline',
    });
    expect(tileMap.prunedOperationsCount).toMatchObject({
      label: 'Ops. podadas',
      value: '42',
      tone: 'success',
      iconName: 'trash-outline',
    });
  });

  it('emits only a single "not available" tile when the bridge is not paired', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: false,
      snapshot: {
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775812200000,
        lastFailureMessage: null,
        lastTriggerSource: 'manual',
        lastSyncedCount: 0,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
        isBackgroundTaskRegistered: false,
        ...CYCLE_POSTMORTEM_DEFAULTS,
      },
    });

    expect(section.statusTone).toBe('warning');
    expect(section.title).toBe('Sync en segundo plano inactivo');
    expect(section.status).toBe('Sin bridge emparejado');
    expect(section.description).toContain('Emparejá un bridge');
    expect(section.tiles).toEqual([
      {
        id: 'registration',
        label: 'Registro',
        value: 'No disponible sin bridge emparejado',
        tone: 'warning',
        iconName: 'link-outline',
      },
    ]);
  });

  it('marks registration as warning tone when the runtime is unsupported', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: {
        registrationStatus: 'unsupported',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureMessage: null,
        lastTriggerSource: null,
        lastSyncedCount: 0,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
        isBackgroundTaskRegistered: false,
        ...CYCLE_POSTMORTEM_DEFAULTS,
      },
    });

    expect(section.statusTone).toBe('warning');
    expect(section.title).toBe('Sync en segundo plano no soportado');
    expect(section.tiles).toEqual([
      {
        id: 'registration',
        label: 'Registro',
        value: 'No soportado',
        tone: 'warning',
        iconName: 'shield-outline',
      },
    ]);
  });

  it('omits every convergence tile when the counters were never measured', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: {
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775811900000,
        lastFailureMessage: null,
        lastTriggerSource: 'app_active',
        lastSyncedCount: 12,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
        isBackgroundTaskRegistered: true,
        ...CYCLE_POSTMORTEM_DEFAULTS,
      },
    });

    const tileIds = section.tiles.map((tile) => tile.id);

    // A NULL counter means "never measured" (design.md Decision 7), not zero -- so no tile
    // renders at all, exactly like `lastAttempt`/`lastSuccess` when their timestamp is null.
    expect(tileIds).not.toEqual(
      expect.arrayContaining([
        'diagnosticsDiscardedCount',
        'diagnosticsFailedRemovalCount',
        'outboxFailedWriteCount',
        'deadLetterCount',
        'conflictExhaustedCount',
        'stuckProcessingCount',
        'oldestPendingAgeMs',
        'pendingRowCount',
      ]),
    );
  });

  it('renders every convergence tile once its counters have been measured', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: {
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775811900000,
        lastFailureMessage: null,
        lastTriggerSource: 'app_active',
        lastSyncedCount: 12,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
        isBackgroundTaskRegistered: true,
        ...CYCLE_POSTMORTEM_DEFAULTS,
        lastDiagnosticsDiscardedCount: 2,
        lastDiagnosticsFailedRemovalCount: 1,
        lastOutboxFailedWriteCount: 3,
        lastDeadLetterCount: 4,
        lastConflictExhaustedCount: 1,
        lastStuckProcessingCount: 2,
        lastOldestPendingAgeMs: 125_000,
        lastPendingRowCount: 210,
      },
    });

    const tileMap = Object.fromEntries(section.tiles.map((tile) => [tile.id, tile]));

    expect(tileMap.diagnosticsDiscardedCount).toMatchObject({ value: '2', tone: 'danger' });
    expect(tileMap.diagnosticsFailedRemovalCount).toMatchObject({ value: '1', tone: 'warning' });
    expect(tileMap.outboxFailedWriteCount).toMatchObject({ value: '3', tone: 'danger' });
    expect(tileMap.deadLetterCount).toMatchObject({ value: '4', tone: 'danger' });
    expect(tileMap.conflictExhaustedCount).toMatchObject({ value: '1', tone: 'danger' });
    expect(tileMap.stuckProcessingCount).toMatchObject({ value: '2', tone: 'warning' });
    expect(tileMap.oldestPendingAgeMs).toMatchObject({ value: '2 min' });
    // 210 > RECONCILE_BACKLOG_BATCH_LIMIT (200): `hasMore` is DERIVED here, never stored
    // (design.md Decision 1), and drives this tile's tone and "+" suffix.
    expect(tileMap.pendingRowCount).toMatchObject({ value: '210+', tone: 'warning' });
  });

  it('reports zero-valued convergence counters in a neutral tone once measured', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: {
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775811900000,
        lastFailureMessage: null,
        lastTriggerSource: 'app_active',
        lastSyncedCount: 12,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
        isBackgroundTaskRegistered: true,
        ...CYCLE_POSTMORTEM_DEFAULTS,
        lastDiagnosticsDiscardedCount: 0,
        lastDiagnosticsFailedRemovalCount: 0,
        lastOutboxFailedWriteCount: 0,
        lastDeadLetterCount: 0,
        lastConflictExhaustedCount: 0,
        lastStuckProcessingCount: 0,
        lastOldestPendingAgeMs: null,
        lastPendingRowCount: 12,
      },
    });

    const tileMap = Object.fromEntries(section.tiles.map((tile) => [tile.id, tile]));

    expect(tileMap.diagnosticsDiscardedCount).toMatchObject({ value: '0', tone: 'default' });
    expect(tileMap.deadLetterCount).toMatchObject({ value: '0', tone: 'default' });
    // A backlog at or under the batch limit reports `hasMore` false (spec: has_more boundary).
    expect(tileMap.pendingRowCount).toMatchObject({ value: '12', tone: 'default' });
    // Still null (an empty queue), so no tile renders for it.
    expect(tileMap.oldestPendingAgeMs).toBeUndefined();
  });
});
