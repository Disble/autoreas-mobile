import { BridgeUnreachableError } from '../../../src/infrastructure/api';
import { resolveSyncFacadeConnectionStatus } from '../../../src/features/sync/bridge-reachability.helpers';
import {
  beginSyncConnectionAttempt,
  forgetSyncConnectionBridge,
  getSyncConnectionSnapshot,
  invalidateSyncConnectionOnline,
  markSyncConnectionFailed,
  markSyncConnectionPending,
  markSyncConnectionSucceeded,
  resetSyncConnectionStore,
} from '../../../src/features/sync/sync-connection-store';
import { deriveVisibleSyncStatus } from '../../../src/features/sync/sync-visible-status.helpers';
import type { SyncRuntimeReachabilityEvidence } from '../../../src/features/sync/bridge-reachability.types';

/** A transport failure: the reconcile never reached the bridge. */
const UNREACHABLE = new BridgeUnreachableError('http://bridge.test/api/sync/reconcile', 'offline');

/** Resolves the facade status from the live store and the given native row. */
function resolveNow(native: SyncRuntimeReachabilityEvidence | null = null) {
  return resolveSyncFacadeConnectionStatus(getSyncConnectionSnapshot(), native);
}

/** Derives the visible copy for a paired, online device with `pendingOpsCount` changes waiting. */
function visibleFor(native: SyncRuntimeReachabilityEvidence | null, pendingOpsCount: number) {
  return deriveVisibleSyncStatus(
    {
      connectionStatus: resolveNow(native),
      isBridgeConfigured: true,
      isDeviceOnline: true,
      lastSyncAt: getSyncConnectionSnapshot().lastSyncAt,
      pendingOpsCount,
    },
    new Date(10_000),
  );
}

describe('bridge reachability (ADR 009 R-9): no "Esperando a la PC" while the bridge is reachable', () => {
  let now: jest.SpyInstance<number, []>;

  beforeEach(() => {
    resetSyncConnectionStore();
    now = jest.spyOn(Date, 'now').mockReturnValue(5_000);
  });

  afterEach(() => {
    now.mockRestore();
  });

  it('F1: a cycle the bridge answered but that left work pending reads as reachable', () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionPending(attempt, 4_000);

    expect(getSyncConnectionSnapshot()).toEqual({
      kind: 'idle',
      lastSyncAt: null,
      message: null,
      bridgeContact: { at: 4_000, reached: true },
    });
    expect(resolveNow()).toBe('reachable');
    expect(visibleFor(null, 2)).toEqual({
      chipLabel: 'Por enviar',
      description: 'Tienes 2 cambios guardados en este dispositivo. Se enviarán en el próximo sync.',
      title: 'Bridge conectado',
      tone: 'default',
    });
  });

  it('F2: new work enqueued after a successful cycle keeps the bridge reachable', () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionSucceeded(attempt, 3_000);
    invalidateSyncConnectionOnline();

    expect(getSyncConnectionSnapshot().kind).toBe('idle');
    expect(resolveNow()).toBe('reachable');
    expect(visibleFor(null, 1).title).toBe('Bridge conectado');
  });

  it('F3: an online cycle with work still counted pending never reads "Esperando a la PC"', () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionSucceeded(attempt, 3_000);

    expect(resolveNow()).toBe('online');
    expect(visibleFor(null, 1)).toMatchObject({ chipLabel: 'Por enviar', title: 'Bridge conectado', tone: 'default' });
  });

  it('F4: a native success newer than the last JS unreachable failure reads as reachable', () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionFailed(attempt, UNREACHABLE);

    expect(getSyncConnectionSnapshot().bridgeContact).toEqual({ at: 5_000, reached: false });
    expect(resolveNow({ lastAttemptAt: 6_000, lastSuccessAt: 6_000 })).toBe('reachable');
    expect(visibleFor({ lastAttemptAt: 6_000, lastSuccessAt: 6_000 }, 1).chipLabel).toBe('Por enviar');
  });

  it('F5: a reachable bridge with a stale backlog is not "Esperando a la PC" either', () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionPending(attempt, 4_000);

    const status = deriveVisibleSyncStatus(
      {
        connectionStatus: resolveNow(),
        isBridgeConfigured: true,
        isDeviceOnline: true,
        lastSyncAt: 1,
        pendingOpsCount: 1,
      },
      new Date(1 + 100 * 60 * 60 * 1000),
    );

    expect(status.chipLabel).toBe('Por enviar');
    expect(status.title).toBe('Bridge conectado');
  });

  it('F6: a reachable bridge with nothing pending never says the PC has not answered', () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionPending(attempt, 4_000);

    expect(visibleFor(null, 0)).toEqual({
      chipLabel: 'Nada por enviar',
      description: 'El Bridge está conectado.',
      title: 'Nada por enviar',
      tone: 'default',
    });
  });

  describe('guards: the waiting state still shows when the bridge is not known to be reachable', () => {
    it('G1: the last JS exchange did not reach the bridge', () => {
      const attempt = beginSyncConnectionAttempt();
      markSyncConnectionFailed(attempt, UNREACHABLE);

      expect(resolveNow()).toBe('unreachable');
      expect(visibleFor(null, 1)).toMatchObject({ chipLabel: 'Esperando a la PC', title: 'Esperando a la PC' });
    });

    it('G2: new work after an unreachable failure still waits', () => {
      const attempt = beginSyncConnectionAttempt();
      markSyncConnectionFailed(attempt, UNREACHABLE);
      invalidateSyncConnectionOnline();

      expect(resolveNow()).toBe('idle');
      expect(visibleFor(null, 1).chipLabel).toBe('Esperando a la PC');
    });

    it('G3: a native success older than the JS unreachable failure is stale', () => {
      const attempt = beginSyncConnectionAttempt();
      markSyncConnectionFailed(attempt, UNREACHABLE);

      expect(resolveNow({ lastAttemptAt: 4_000, lastSuccessAt: 4_000 })).toBe('unreachable');
    });

    it('G4: a native success followed by a later native failure is not evidence', () => {
      const attempt = beginSyncConnectionAttempt();
      markSyncConnectionFailed(attempt, UNREACHABLE);

      expect(resolveNow({ lastAttemptAt: 7_000, lastSuccessAt: 6_000 })).toBe('unreachable');
    });

    it('G5: with no JS exchange yet, an old native success is not trusted', () => {
      expect(resolveNow({ lastAttemptAt: 6_000, lastSuccessAt: 6_000 })).toBe('idle');
      expect(visibleFor({ lastAttemptAt: 6_000, lastSuccessAt: 6_000 }, 1).chipLabel).toBe('Esperando a la PC');
    });

    it('G6: unpairing forgets the bridge, so a new pairing starts unknown', () => {
      const attempt = beginSyncConnectionAttempt();
      markSyncConnectionSucceeded(attempt, 3_000);
      forgetSyncConnectionBridge();

      expect(getSyncConnectionSnapshot()).toEqual({
        kind: 'idle',
        lastSyncAt: 3_000,
        message: null,
        bridgeContact: null,
      });
      expect(resolveNow({ lastAttemptAt: 6_000, lastSuccessAt: 6_000 })).toBe('idle');
    });
  });

  describe('evidence bookkeeping', () => {
    it('keeps the previous contact when the bridge answered with a rejection', () => {
      const attempt = beginSyncConnectionAttempt();
      markSyncConnectionSucceeded(attempt, 3_000);
      const rejected = beginSyncConnectionAttempt();
      markSyncConnectionFailed(rejected, new Error('Reconcile failed: 422'));

      expect(getSyncConnectionSnapshot().bridgeContact).toEqual({ at: 3_000, reached: true });
      expect(resolveNow()).toBe('sync_error');
    });

    it('ignores the evidence of a stale attempt', () => {
      const stale = beginSyncConnectionAttempt();
      beginSyncConnectionAttempt();
      markSyncConnectionPending(stale, 4_000);
      markSyncConnectionFailed(stale, UNREACHABLE);

      expect(getSyncConnectionSnapshot().bridgeContact).toBeNull();
    });

    it('passes a running sync through untouched', () => {
      const attempt = beginSyncConnectionAttempt();
      markSyncConnectionPending(attempt, 4_000);
      beginSyncConnectionAttempt();

      expect(resolveNow({ lastAttemptAt: 6_000, lastSuccessAt: 6_000 })).toBe('syncing');
    });
  });
});
