import { createNativeForegroundSyncTicker } from '../../../src/features/sync/native-foreground-sync-ticker.helpers';
import type { NativeForegroundSyncTickerModule } from '../../../src/features/sync/native-foreground-sync-ticker.types';

/** Flushes pending microtasks (the cycle-promise settle path) before assertions. */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('native-foreground-sync-ticker', () => {
  function buildNativeModule() {
    const listeners: (() => void | Promise<void>)[] = [];

    const module: NativeForegroundSyncTickerModule = {
      start: jest.fn(),
      stop: jest.fn(),
      notifyCycleComplete: jest.fn(),
      isRunning: jest.fn().mockReturnValue(false),
      addListener: jest.fn((_eventName: 'onTick', listener: () => void | Promise<void>) => {
        listeners.push(listener);

        return {
          remove: jest.fn(() => {
            const index = listeners.indexOf(listener);
            if (index >= 0) {
              listeners.splice(index, 1);
            }
          }),
        };
      }),
    };

    return {
      module,
      fireTick: () => {
        listeners.forEach((listener) => void listener());
      },
    };
  }

  it('degrades to a no-op ticker when the native module is unavailable', () => {
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => null,
    });

    const unsubscribe = ticker.onTick(jest.fn());

    expect(() => ticker.start(15_000)).not.toThrow();
    expect(ticker.isRunning()).toBe(false);
    expect(() => ticker.stop()).not.toThrow();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('starts the native module and forwards ticks to subscribers', () => {
    const { module, fireTick } = buildNativeModule();
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => module,
    });
    const onTick = jest.fn();

    ticker.onTick(onTick);
    ticker.start(15_000);

    expect(module.addListener).toHaveBeenCalledWith('onTick', expect.any(Function));
    expect(module.start).toHaveBeenCalledWith(15_000);
    expect(ticker.isRunning()).toBe(true);

    fireTick();

    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('releases the native cycle wake lock when the tick listener promise resolves', async () => {
    const { module, fireTick } = buildNativeModule();
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => module,
    });

    let resolveCycle!: () => void;
    ticker.onTick(
      () =>
        new Promise<void>((resolve) => {
          resolveCycle = resolve;
        }),
    );
    ticker.start(15_000);

    fireTick();
    await flushMicrotasks();

    // The cycle is still running: the wake lock stays held (no release reported yet).
    expect(module.notifyCycleComplete).not.toHaveBeenCalled();

    resolveCycle();
    await flushMicrotasks();

    expect(module.notifyCycleComplete).toHaveBeenCalledTimes(1);
  });

  it('releases the native cycle wake lock when the tick listener promise rejects', async () => {
    const { module, fireTick } = buildNativeModule();
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => module,
    });

    let rejectCycle!: (error: Error) => void;
    ticker.onTick(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCycle = reject;
        }),
    );
    ticker.start(15_000);

    fireTick();
    await flushMicrotasks();
    expect(module.notifyCycleComplete).not.toHaveBeenCalled();

    rejectCycle(new Error('cycle failed'));
    await flushMicrotasks();

    expect(module.notifyCycleComplete).toHaveBeenCalledTimes(1);
  });

  it('releases the native cycle wake lock only after every promise of the tick settles', async () => {
    const { module, fireTick } = buildNativeModule();
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => module,
    });

    const resolvers: (() => void)[] = [];
    ticker.onTick(() => new Promise<void>((resolve) => resolvers.push(resolve)));
    ticker.onTick(() => new Promise<void>((resolve) => resolvers.push(resolve)));
    ticker.start(15_000);

    fireTick();
    await flushMicrotasks();

    resolvers[0]?.();
    await flushMicrotasks();

    // One of two cycles settled; the wake lock must stay held for the other one.
    expect(module.notifyCycleComplete).not.toHaveBeenCalled();

    resolvers[1]?.();
    await flushMicrotasks();

    expect(module.notifyCycleComplete).toHaveBeenCalledTimes(1);
  });

  it('releases the native cycle wake lock for a tick whose listener returns no promise', () => {
    const { module, fireTick } = buildNativeModule();
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => module,
    });

    ticker.onTick(jest.fn());
    ticker.start(15_000);

    fireTick();

    expect(module.notifyCycleComplete).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops delivering ticks to that listener', () => {
    const { module, fireTick } = buildNativeModule();
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => module,
    });
    const onTick = jest.fn();

    const unsubscribe = ticker.onTick(onTick);
    ticker.start(15_000);
    unsubscribe();
    fireTick();

    expect(onTick).not.toHaveBeenCalled();
  });

  it('stop tears down the native subscription and module', () => {
    const { module } = buildNativeModule();
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => module,
    });

    ticker.start(15_000);
    ticker.stop();

    expect(module.stop).toHaveBeenCalledTimes(1);
    expect(ticker.isRunning()).toBe(false);
  });

  it('does not stop the native module before starting', () => {
    const { module } = buildNativeModule();
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => module,
    });

    ticker.stop();

    expect(module.stop).not.toHaveBeenCalled();
    expect(ticker.isRunning()).toBe(false);
  });

  it('does not start twice while already running', () => {
    const { module } = buildNativeModule();
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => module,
    });

    ticker.start(15_000);
    ticker.start(15_000);

    expect(module.start).toHaveBeenCalledTimes(1);
  });

  it('treats an unexpected native module lookup error as unavailable instead of throwing', () => {
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => {
        throw new Error('bridge not ready');
      },
    });

    expect(() => ticker.start(15_000)).not.toThrow();
    expect(ticker.isRunning()).toBe(false);
  });
});
