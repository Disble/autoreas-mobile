import {
  RESET_TARGET_DATABASE_NAME,
  createDatabaseResetOrchestrator,
  type DatabaseResetPorts,
  type ResetDecisionInput,
  type ResetIntent,
  type ResetRefusalReason,
} from '../../../../src/infrastructure/db/recovery';

/** The single timestamp every harness clock reports, so written intents are deterministic. */
const NOW = 1_700_000_000_000;

/** Names each port a test can make fail exactly once, to simulate process death. */
type ResetPortName =
  | 'readResetIntent'
  | 'writeResetIntent'
  | 'stopNativeWriters'
  | 'closeDatabaseConnections'
  | 'isDatabasePresent'
  | 'deleteDatabase'
  | 'clearResetIntent'
  | 'openAndPrepare';

/** Exposes a fully injected port set plus the observations a test asserts on. */
interface ResetHarness {
  readonly ports: DatabaseResetPorts;
  readonly events: string[];
  readonly deleteCalls: string[];
  readonly writtenIntents: ResetIntent[];
  readonly storedIntent: () => unknown;
  readonly isPresent: () => boolean;
  readonly openAndPrepareCalls: () => number;
  readonly failPort: (port: ResetPortName | null) => void;
}

/**
 * Builds an in-memory stand-in for every side effect the reset boundary injects. The deletion port
 * is the only one that mutates the "filesystem": it records the call and, unless it is the port
 * under test, marks the database gone.
 */
function createHarness(
  params: {
    readonly databasePresent?: boolean;
    readonly storedIntent?: unknown;
    readonly failPort?: ResetPortName;
  } = {},
): ResetHarness {
  let databasePresent = params.databasePresent ?? true;
  let storedIntent: unknown = params.storedIntent ?? null;
  let failingPort: ResetPortName | null = params.failPort ?? null;
  let openAndPrepareCount = 0;
  const events: string[] = [];
  const deleteCalls: string[] = [];
  const writtenIntents: ResetIntent[] = [];

  function failOnce(port: ResetPortName): void {
    if (failingPort === port) {
      failingPort = null;
      throw new Error(`${port} failed`);
    }
  }

  const ports: DatabaseResetPorts = {
    readResetIntent: async () => {
      events.push('readResetIntent');
      failOnce('readResetIntent');
      return storedIntent;
    },
    writeResetIntent: async (intent) => {
      events.push('writeResetIntent');
      failOnce('writeResetIntent');
      writtenIntents.push(intent);
      storedIntent = intent;
    },
    stopNativeWriters: async () => {
      events.push('stopNativeWriters');
      failOnce('stopNativeWriters');
    },
    closeDatabaseConnections: async () => {
      events.push('closeDatabaseConnections');
      failOnce('closeDatabaseConnections');
    },
    isDatabasePresent: async () => {
      events.push('isDatabasePresent');
      failOnce('isDatabasePresent');
      return databasePresent;
    },
    deleteDatabase: async (databaseName) => {
      events.push(`deleteDatabase:${databaseName}`);
      deleteCalls.push(databaseName);
      failOnce('deleteDatabase');
      databasePresent = false;
    },
    clearResetIntent: async () => {
      events.push('clearResetIntent');
      failOnce('clearResetIntent');
      storedIntent = null;
    },
    openAndPrepare: async () => {
      events.push('openAndPrepare');
      openAndPrepareCount += 1;
      failOnce('openAndPrepare');
      databasePresent = true;
    },
    now: () => NOW,
  };

  return {
    ports,
    events,
    deleteCalls,
    writtenIntents,
    storedIntent: () => storedIntent,
    isPresent: () => databasePresent,
    openAndPrepareCalls: () => openAndPrepareCount,
    failPort: (port) => {
      failingPort = port;
    },
  };
}

/** The only input that authorizes destruction: confirmed physical corruption, nothing else. */
const authorizedInput: ResetDecisionInput = {
  classification: 'corruption',
};

/** Every refusal the boundary must expose, with the exact reason it must report. */
const refusalCases: readonly (readonly [string, ResetDecisionInput, ResetRefusalReason])[] = [
  ['busy', { classification: 'busy' }, 'busy'],
  ['unknown', { classification: 'unknown' }, 'unknown'],
  ['schema_validation', { classification: 'schema_validation' }, 'schema_validation'],
  ['incompatible_schema', { classification: 'incompatible_schema' }, 'incompatible_schema'],
  ['sqlite', { classification: 'sqlite' }, 'sqlite'],
];

describe('database reset orchestration', () => {
  it('runs the whole boundary in order and clears the intent only after preparation', async () => {
    const harness = createHarness({ databasePresent: true });

    const outcome = await createDatabaseResetOrchestrator(harness.ports).run(authorizedInput);

    expect(outcome).toEqual({ status: 'completed', deleted: true });
    expect(harness.events).toEqual([
      'readResetIntent',
      'writeResetIntent',
      'stopNativeWriters',
      'closeDatabaseConnections',
      'isDatabasePresent',
      `deleteDatabase:${RESET_TARGET_DATABASE_NAME}`,
      'openAndPrepare',
      'clearResetIntent',
    ]);
    expect(harness.writtenIntents).toEqual([{ reason: 'confirmed_corruption', requestedAt: NOW }]);
    expect(harness.openAndPrepareCalls()).toBe(1);
    expect(harness.storedIntent()).toBeNull();
  });

  it('awaits the close port before it deletes anything', async () => {
    // A recording port that only settles when released: while the close promise is pending the
    // orchestrator must NOT have reached the deletion, which proves the close is AWAITED rather
    // than fired and forgotten before the destructive step.
    let releaseClose!: () => void;
    const closeSettled = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const events: string[] = [];
    const ports: DatabaseResetPorts = {
      clearResetIntent: async () => undefined,
      closeDatabaseConnections: async () => {
        events.push('close:start');
        await closeSettled;
        events.push('close:done');
      },
      deleteDatabase: async () => {
        events.push('delete');
      },
      isDatabasePresent: async () => true,
      now: () => NOW,
      openAndPrepare: async () => undefined,
      readResetIntent: async () => null,
      stopNativeWriters: async () => undefined,
      writeResetIntent: async () => undefined,
    };

    const run = createDatabaseResetOrchestrator(ports).run(authorizedInput);

    // Let every earlier awaited step run until the pending close genuinely starts.
    for (let step = 0; step < 20 && !events.includes('close:start'); step += 1) {
      await Promise.resolve();
    }

    expect(events).toContain('close:start');
    expect(events).not.toContain('delete');

    releaseClose();
    await expect(run).resolves.toEqual({ status: 'completed', deleted: true });
    expect(events.indexOf('close:done')).toBeLessThan(events.indexOf('delete'));
  });

  it('resets a confirmed-corruption database with the Bridge offline and no configuration', async () => {
    // Correction (parent review): the Bridge and stored configuration are NOT prerequisites. The
    // reset must run to completion exactly like the authorized input above; pairing and snapshot
    // happen AFTER the reset, so gating on them would strand the user this recovery exists for.
    const harness = createHarness({ databasePresent: true });
    const offlineUnconfigured = {
      classification: 'corruption',
      isBridgeAvailable: false,
      isConfigurationPresent: false,
    } as unknown as ResetDecisionInput;

    const outcome = await createDatabaseResetOrchestrator(harness.ports).run(offlineUnconfigured);

    expect(outcome).toEqual({ status: 'completed', deleted: true });
    expect(harness.events).toEqual([
      'readResetIntent',
      'writeResetIntent',
      'stopNativeWriters',
      'closeDatabaseConnections',
      'isDatabasePresent',
      `deleteDatabase:${RESET_TARGET_DATABASE_NAME}`,
      'openAndPrepare',
      'clearResetIntent',
    ]);
  });

  it.each(refusalCases)(
    'refuses %s without touching the database or the intent',
    async (_label, input, reason) => {
      const harness = createHarness({ databasePresent: true });

      const outcome = await createDatabaseResetOrchestrator(harness.ports).run(input);

      expect(outcome).toEqual({ status: 'refused', reason });
      expect(harness.deleteCalls).toEqual([]);
      expect(harness.writtenIntents).toEqual([]);
      expect(harness.openAndPrepareCalls()).toBe(0);
      expect(harness.events).toEqual(['readResetIntent']);
    },
  );

  it('leaves the intent unwritten when a busy diagnostic accompanies a forced override', async () => {
    const harness = createHarness({ databasePresent: true });
    const forcedInput = {
      classification: 'busy',
      force: true,
    } as unknown as ResetDecisionInput;

    const outcome = await createDatabaseResetOrchestrator(harness.ports).run(forcedInput);

    expect(outcome).toEqual({ status: 'refused', reason: 'busy' });
    expect(harness.writtenIntents).toEqual([]);
    expect(harness.deleteCalls).toEqual([]);
  });

  it('targets only the application database and never a protected sibling or a sidecar', async () => {
    const harness = createHarness({ databasePresent: true });

    await createDatabaseResetOrchestrator(harness.ports).run(authorizedInput);

    expect(harness.deleteCalls).toEqual(['autoreas.db']);
    const recorded = [...harness.events, ...harness.deleteCalls];
    expect(recorded.some((entry) => entry.includes('sync-journal.db'))).toBe(false);
    expect(recorded.some((entry) => entry.includes('autoreas-telemetry.db'))).toBe(false);
    expect(recorded.some((entry) => entry.includes('-wal') || entry.includes('-shm'))).toBe(false);
  });

  it.each([
    ['stopNativeWriters', 'stop_native_writers'],
    ['closeDatabaseConnections', 'close_connections'],
    ['isDatabasePresent', 'database_probe'],
  ] as const)(
    'a death at %s leaves the intent in place and the resumed run deletes exactly once',
    async (port, stage) => {
      const harness = createHarness({ failPort: port });
      const orchestrator = createDatabaseResetOrchestrator(harness.ports);

      expect(await orchestrator.run(authorizedInput)).toEqual({ status: 'failed', stage });
      expect(harness.writtenIntents).toHaveLength(1);
      expect(harness.storedIntent()).not.toBeNull();
      expect(harness.deleteCalls).toEqual([]);

      expect(await orchestrator.run(authorizedInput)).toEqual({ status: 'completed', deleted: true });
      expect(harness.deleteCalls).toEqual([RESET_TARGET_DATABASE_NAME]);
    },
  );

  it('a death while clearing the intent resumes, re-prepares and then clears the surviving intent', async () => {
    const harness = createHarness({ failPort: 'clearResetIntent' });
    const orchestrator = createDatabaseResetOrchestrator(harness.ports);

    expect(await orchestrator.run(authorizedInput)).toEqual({ status: 'failed', stage: 'intent_clear' });
    expect(harness.deleteCalls).toEqual([RESET_TARGET_DATABASE_NAME]);
    // Preparation already ran and recreated the database, and the intent survived the failed clear:
    // the durable evidence of the in-flight reset is intact.
    expect(harness.isPresent()).toBe(true);
    expect(harness.storedIntent()).not.toBeNull();
    expect(harness.openAndPrepareCalls()).toBe(1);

    // The resume probes the (now present, freshly prepared, empty) database, prepares again
    // idempotently and finally clears the intent. A second deletion here targets only the empty
    // database preparation just created, never user data, which was already destroyed.
    expect(await orchestrator.run(authorizedInput)).toEqual({ status: 'completed', deleted: true });
    expect(harness.openAndPrepareCalls()).toBe(2);
    expect(harness.storedIntent()).toBeNull();
  });

  it('a death during preparation leaves the intent; the next run prepares again, succeeds, then clears it', async () => {
    const harness = createHarness({ failPort: 'openAndPrepare' });
    const orchestrator = createDatabaseResetOrchestrator(harness.ports);

    expect(await orchestrator.run(authorizedInput)).toEqual({
      status: 'failed',
      stage: 'database_prepare',
    });
    expect(harness.deleteCalls).toEqual([RESET_TARGET_DATABASE_NAME]);
    expect(harness.openAndPrepareCalls()).toBe(1);
    expect(harness.storedIntent()).not.toBeNull();

    expect(await orchestrator.run(authorizedInput)).toEqual({ status: 'completed', deleted: false });
    expect(harness.deleteCalls).toEqual([RESET_TARGET_DATABASE_NAME]);
    expect(harness.openAndPrepareCalls()).toBe(2);
    expect(harness.storedIntent()).toBeNull();
  });

  it('a failed deletion is retried on resume and never mistaken for a completed reset', async () => {
    const harness = createHarness({ failPort: 'deleteDatabase' });
    const orchestrator = createDatabaseResetOrchestrator(harness.ports);

    expect(await orchestrator.run(authorizedInput)).toEqual({
      status: 'failed',
      stage: 'database_delete',
    });
    expect(harness.isPresent()).toBe(true);
    expect(harness.storedIntent()).not.toBeNull();

    expect(await orchestrator.run(authorizedInput)).toEqual({ status: 'completed', deleted: true });
    expect(harness.deleteCalls).toEqual([RESET_TARGET_DATABASE_NAME, RESET_TARGET_DATABASE_NAME]);
  });

  it('a death before the intent is durably written leaves nothing destructive behind', async () => {
    const harness = createHarness({ failPort: 'writeResetIntent' });
    const orchestrator = createDatabaseResetOrchestrator(harness.ports);

    expect(await orchestrator.run(authorizedInput)).toEqual({ status: 'failed', stage: 'intent_write' });
    expect(harness.writtenIntents).toEqual([]);
    expect(harness.deleteCalls).toEqual([]);
    expect(harness.events).toEqual(['readResetIntent', 'writeResetIntent']);

    expect(await orchestrator.run(authorizedInput)).toEqual({ status: 'completed', deleted: true });
    expect(harness.deleteCalls).toEqual([RESET_TARGET_DATABASE_NAME]);
  });

  it('a death while reading the intent aborts before any destructive port runs', async () => {
    const harness = createHarness({ failPort: 'readResetIntent' });

    expect(await createDatabaseResetOrchestrator(harness.ports).run(authorizedInput)).toEqual({
      status: 'failed',
      stage: 'intent_read',
    });
    expect(harness.events).toEqual(['readResetIntent']);
  });

  it('treats a foreign intent payload as absent and refuses on a refusing diagnostic', async () => {
    const harness = createHarness({
      databasePresent: true,
      storedIntent: { reason: 'confirmed_corruption', requestedAt: 1, deviceId: 'secret' },
    });

    const outcome = await createDatabaseResetOrchestrator(harness.ports).run({
      classification: 'busy',
    });

    expect(outcome).toEqual({ status: 'refused', reason: 'busy' });
    expect(harness.deleteCalls).toEqual([]);
    expect(harness.writtenIntents).toEqual([]);
  });

  it('overwrites a malformed intent once corruption is confirmed', async () => {
    const harness = createHarness({
      databasePresent: true,
      storedIntent: { reason: 'confirmed_corruption', requestedAt: -5 },
    });

    const outcome = await createDatabaseResetOrchestrator(harness.ports).run(authorizedInput);

    expect(outcome).toEqual({ status: 'completed', deleted: true });
    expect(harness.writtenIntents).toEqual([{ reason: 'confirmed_corruption', requestedAt: NOW }]);
    expect(Object.keys(harness.writtenIntents[0]).sort()).toEqual(['reason', 'requestedAt']);
  });

  it('collapses a concurrent double press into a single deletion', async () => {
    const harness = createHarness({ databasePresent: true });
    const orchestrator = createDatabaseResetOrchestrator(harness.ports);

    const [first, second] = await Promise.all([
      orchestrator.run(authorizedInput),
      orchestrator.run(authorizedInput),
    ]);

    expect(first).toEqual({ status: 'completed', deleted: true });
    expect(second).toEqual(first);
    expect(harness.deleteCalls).toEqual([RESET_TARGET_DATABASE_NAME]);
    expect(harness.openAndPrepareCalls()).toBe(1);
  });

  it('starts a fresh attempt once the in-flight operation settles', async () => {
    const harness = createHarness({ databasePresent: true });
    const orchestrator = createDatabaseResetOrchestrator(harness.ports);

    await orchestrator.run(authorizedInput);
    const second = await orchestrator.run({
      classification: 'busy',
    });

    expect(second).toEqual({ status: 'refused', reason: 'busy' });
  });
});
