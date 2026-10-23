import {
  appendScreenStallTransition,
  buildScreenStallWirePayload,
  recordScreenStall,
  toScreenStallAppState,
} from '../../../src/features/screen-health/screen-stall.helpers';
import type {
  ScreenStallProbeStart,
  ScreenStallTransition,
  ScreenStallWirePayload,
} from '../../../src/features/screen-health/screen-stall.types';

jest.mock(
  '../../../src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants',
  () => ({ syncDiagnosticsOutboxStore: { enqueue: jest.fn() } }),
);

/** A probe armed by a touch in a split-screen window. */
const START: ScreenStallProbeStart = {
  trigger: 'touch',
  armedAtMs: 1_000_000,
  appState: 'active',
  windowFocused: true,
  windowSize: { width: 640.4, height: 800 },
  screenSize: { width: 1280, height: 800 },
};

/** Two transitions seen before the probe settled. */
const TRANSITIONS: readonly ScreenStallTransition[] = [
  { event: 'active', atMs: 999_000 },
  { event: 'resize', atMs: 999_500 },
];

describe('buildScreenStallWirePayload', () => {
  it('builds the full contract body for a probe at the threshold', () => {
    expect(buildScreenStallWirePayload(START, 1_002_000, TRANSITIONS, 'obs-1')).toEqual({
      kind: 'screen_stall',
      observation_id: 'obs-1',
      observed_at_ms: 1_000_000,
      duration_ms: 2000,
      trigger: 'touch',
      app_state: 'active',
      window_focused: true,
      window_width: 640,
      window_height: 800,
      screen_width: 1280,
      screen_height: 800,
      transitions: [
        { event: 'active', at_ms: 999_000 },
        { event: 'resize', at_ms: 999_500 },
      ],
    });
  });

  it('reports nothing for a healthy probe under the threshold', () => {
    expect(buildScreenStallWirePayload(START, 1_001_999, TRANSITIONS, 'obs-1')).toBeNull();
  });

  it('drops a probe beyond the bridge maximum instead of clamping it', () => {
    expect(buildScreenStallWirePayload(START, 1_000_000 + 3_600_001, [], 'obs-1')).toBeNull();
  });

  it('drops a probe whose window size is not positive', () => {
    const start = { ...START, windowSize: { width: 0, height: 800 } };

    expect(buildScreenStallWirePayload(start, 1_005_000, [], 'obs-1')).toBeNull();
  });

  it('drops a probe whose size rounds below one dp', () => {
    const start = { ...START, screenSize: { width: 0.4, height: 800 } };

    expect(buildScreenStallWirePayload(start, 1_005_000, [], 'obs-1')).toBeNull();
  });

  it('keeps a null window focus when no focus or blur was seen', () => {
    const start = { ...START, windowFocused: null };

    expect(buildScreenStallWirePayload(start, 1_005_000, [], 'obs-1')?.window_focused).toBeNull();
  });
});

describe('appendScreenStallTransition', () => {
  it('keeps only the newest eight transitions, oldest first', () => {
    let transitions: readonly ScreenStallTransition[] = [];
    for (let index = 0; index < 10; index += 1) {
      transitions = appendScreenStallTransition(transitions, { event: 'focus', atMs: index });
    }

    expect(transitions.map((transition) => transition.atMs)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('toScreenStallAppState', () => {
  it('passes a known app state through', () => {
    expect(toScreenStallAppState('background')).toBe('background');
  });

  it('maps an unrecognized or missing state to unknown', () => {
    expect(toScreenStallAppState('extension')).toBe('unknown');
    expect(toScreenStallAppState(null)).toBe('unknown');
  });
});

describe('recordScreenStall', () => {
  const payload = buildScreenStallWirePayload(
    START,
    1_005_000,
    TRANSITIONS,
    'obs-9',
  ) as ScreenStallWirePayload;

  it('stores the body under its observation id once the bridge accepts the kind', () => {
    const store = { enqueue: jest.fn() };

    recordScreenStall(payload, { store, isAccepted: () => true });

    expect(store.enqueue).toHaveBeenCalledWith({
      cycleId: 'obs-9',
      payload: JSON.stringify(payload),
    });
  });

  it('stores the body through the accepted-kinds registry by default', () => {
    const store = { enqueue: jest.fn() };

    recordScreenStall(payload, { store });

    expect(store.enqueue).toHaveBeenCalledTimes(1);
  });

  it('stores nothing while the bridge does not accept the kind', () => {
    const store = { enqueue: jest.fn() };

    recordScreenStall(payload, { store, isAccepted: () => false });

    expect(store.enqueue).not.toHaveBeenCalled();
  });

  it('swallows a storage failure', () => {
    const store = {
      enqueue: jest.fn(() => {
        throw new Error('disk full');
      }),
    };

    expect(() => recordScreenStall(payload, { store, isAccepted: () => true })).not.toThrow();
  });
});
