import type { SQLiteDatabase } from 'expo-sqlite';
import {
  recordNetworkTransition,
  resolveNetworkTransition,
} from '../../../src/features/sync/sync-runtime-network.helpers';

/** A dummy database handle: the config read that would use it is injected. */
const RAW_DB = { id: 'raw-db' } as unknown as SQLiteDatabase;

/** A recording diary whose transitions each test reads back. */
function buildDiary(): { recordRuntimeTransition: jest.Mock } {
  return { recordRuntimeTransition: jest.fn() };
}

describe('resolveNetworkTransition', () => {
  it.each([
    [null, true, null],
    [null, false, null],
    [true, true, null],
    [false, false, null],
    [false, true, 'started'],
    [true, false, 'stopped'],
  ] as const)('from %p to %p is %p', (previous, isConnected, expected) => {
    expect(resolveNetworkTransition(previous, isConnected)).toBe(expected);
  });
});

describe('recordNetworkTransition', () => {
  it('reports the change as a network transition when the switch is on and the kind is served', async () => {
    const diary = buildDiary();
    const readConfig = jest.fn().mockResolvedValue({ isSyncTelemetryEnabled: true });
    const isAccepted = jest.fn().mockReturnValue(true);

    await recordNetworkTransition({ rawDb: RAW_DB, transition: 'stopped' }, { readConfig, diary, isAccepted });

    expect(readConfig).toHaveBeenCalledWith(RAW_DB);
    expect(isAccepted).toHaveBeenCalledWith({ kind: 'runtime_transition' });
    expect(diary.recordRuntimeTransition.mock.calls).toEqual([['network', 'stopped']]);
  });

  it.each([
    ['the switch is off', { isSyncTelemetryEnabled: false }, true],
    ['the bridge does not serve the kind', { isSyncTelemetryEnabled: true }, false],
  ])('records nothing when %s', async (_case, config, accepted) => {
    const diary = buildDiary();

    await recordNetworkTransition(
      { rawDb: RAW_DB, transition: 'started' },
      { readConfig: jest.fn().mockResolvedValue(config), diary, isAccepted: () => accepted },
    );

    expect(diary.recordRuntimeTransition).not.toHaveBeenCalled();
  });

  it('records nothing without a database and never rejects when the config read fails', async () => {
    const diary = buildDiary();
    const readConfig = jest.fn().mockRejectedValue(new Error('locked'));

    await recordNetworkTransition({ rawDb: null, transition: 'started' }, { readConfig, diary });
    await expect(
      recordNetworkTransition({ rawDb: RAW_DB, transition: 'started' }, { readConfig, diary }),
    ).resolves.toBeUndefined();

    expect(readConfig).toHaveBeenCalledTimes(1);
    expect(diary.recordRuntimeTransition).not.toHaveBeenCalled();
  });
});
