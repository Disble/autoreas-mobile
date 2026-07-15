import { BridgeUnreachableError } from '../../../src/infrastructure/api';
import {
  beginSyncConnectionAttempt,
  getSyncConnectionSnapshot,
  markSyncConnectionFailed,
  markSyncConnectionSucceeded,
  publishSyncConnectionAttempt,
  resetSyncConnectionStore,
  subscribeSyncConnection,
} from '../../../src/features/sync/sync-connection-store';

describe('sync connection store', () => {
  beforeEach(() => {
    resetSyncConnectionStore();
  });

  it('publishes an unreachable failure to every subscriber without erasing the last success', () => {
    const firstSubscriber = jest.fn();
    const secondSubscriber = jest.fn();
    const unsubscribeFirst = subscribeSyncConnection(firstSubscriber);
    const unsubscribeSecond = subscribeSyncConnection(secondSubscriber);

    const successAttempt = beginSyncConnectionAttempt();
    markSyncConnectionSucceeded(successAttempt, 1_000);
    const failedAttempt = beginSyncConnectionAttempt();
    markSyncConnectionFailed(
      failedAttempt,
      new BridgeUnreachableError('http://bridge.test/api/sync/reconcile', 'offline'),
    );

    expect(getSyncConnectionSnapshot()).toEqual({
      kind: 'unreachable',
      lastSyncAt: 1_000,
      message: 'Bridge unreachable at http://bridge.test/api/sync/reconcile',
    });
    expect(firstSubscriber).toHaveBeenCalledTimes(4);
    expect(secondSubscriber).toHaveBeenCalledTimes(4);

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('keeps reachable sync failures distinct from transport unreachability', () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionFailed(attempt, new Error('Reconcile failed: 422'));

    expect(getSyncConnectionSnapshot()).toEqual({
      kind: 'sync_error',
      lastSyncAt: null,
      message: 'Reconcile failed: 422',
    });
  });

  it('ignores stale success after a newer authoritative attempt fails', () => {
    const olderAttempt = beginSyncConnectionAttempt();
    const newerAttempt = beginSyncConnectionAttempt();
    const unreachableError = new BridgeUnreachableError(
      'http://bridge.test/api/sync/reconcile',
      'offline',
    );

    markSyncConnectionFailed(newerAttempt, unreachableError);
    markSyncConnectionSucceeded(olderAttempt, 2_000);

    expect(getSyncConnectionSnapshot()).toEqual({
      kind: 'unreachable',
      lastSyncAt: null,
      message: unreachableError.message,
    });
  });

  it('settles newer failure telemetry after an older success write already started', async () => {
    let resolveOlderTelemetry!: () => void;
    const persistedOutcomes: string[] = [];
    const olderAttempt = beginSyncConnectionAttempt();
    const olderPublication = publishSyncConnectionAttempt({
      attempt: olderAttempt,
      persistTelemetry: () =>
        new Promise<void>((resolve) => {
          resolveOlderTelemetry = () => {
            persistedOutcomes.push('success');
            resolve();
          };
        }),
      publishConnection: () => markSyncConnectionSucceeded(olderAttempt, 2_000),
    });
    await Promise.resolve();

    const newerAttempt = beginSyncConnectionAttempt();
    const unreachableError = new BridgeUnreachableError(
      'http://bridge.test/api/sync/reconcile',
      'offline',
    );
    const newerPublication = publishSyncConnectionAttempt({
      attempt: newerAttempt,
      persistTelemetry: async () => {
        persistedOutcomes.push('failure');
      },
      publishConnection: () => markSyncConnectionFailed(newerAttempt, unreachableError),
    });

    resolveOlderTelemetry();
    await expect(olderPublication).resolves.toBe(false);
    await expect(newerPublication).resolves.toBe(true);

    expect(persistedOutcomes).toEqual(['success', 'failure']);
    expect(getSyncConnectionSnapshot()).toEqual({
      kind: 'unreachable',
      lastSyncAt: null,
      message: unreachableError.message,
    });
  });
});
