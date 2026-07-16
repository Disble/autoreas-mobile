import { createNativeForegroundSyncTicker } from '../../../src/features/sync/native-foreground-sync-ticker.helpers';
import type { NativeForegroundSyncTickerModule } from '../../../src/features/sync/native-foreground-sync-ticker.types';

describe('native-foreground-sync-ticker', () => {
  function buildNativeModule() {
    const listeners: Array<() => void> = [];

    const module: NativeForegroundSyncTickerModule = {
      start: jest.fn(),
      stop: jest.fn(),
      acknowledgeTick: jest.fn(),
      isRunning: jest.fn().mockReturnValue(false),
      addListener: jest.fn((_eventName: 'onTick', listener: () => void) => {
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
        listeners.forEach((listener) => listener());
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

    expect(module.start).toHaveBeenCalledWith(15_000);
    expect(ticker.isRunning()).toBe(true);

    fireTick();

    expect(onTick).toHaveBeenCalledTimes(1);
    expect(module.acknowledgeTick).toHaveBeenCalledTimes(1);
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
