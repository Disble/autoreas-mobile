import { createNativeForegroundSyncTicker } from '../../../src/features/sync/native-foreground-sync-ticker.helpers';
import type { NativeForegroundSyncTickerModule } from '../../../src/features/sync/native-foreground-sync-ticker.types';

describe('native-foreground-sync-ticker', () => {
  function buildNativeModule(
    overrides: Partial<NativeForegroundSyncTickerModule> = {},
  ): NativeForegroundSyncTickerModule {
    return {
      start: jest.fn(),
      stop: jest.fn(),
      isRunning: jest.fn().mockReturnValue(false),
      ...overrides,
    };
  }

  it('degrades to a no-op ticker when the native module is unavailable', () => {
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => null,
    });

    expect(() => ticker.start(60_000)).not.toThrow();
    expect(ticker.isRunning()).toBe(false);
    expect(() => ticker.stop()).not.toThrow();
  });

  it('starts native ticking by delegating straight to the native module', () => {
    const module = buildNativeModule();
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => module,
    });

    ticker.start(60_000);

    expect(module.start).toHaveBeenCalledWith(60_000);
  });

  it('stops native ticking by delegating straight to the native module', () => {
    const module = buildNativeModule();
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => module,
    });

    ticker.stop();

    expect(module.stop).toHaveBeenCalledTimes(1);
  });

  it('calls start again on every invocation, relying on the native side for idempotency', () => {
    // Native `startTicking()` always stops then restarts (T4), so a caller like "app open while
    // the mode is on" (register() running again) is safe to call unconditionally -- idempotency
    // lives natively, not behind a JS guard.
    const module = buildNativeModule();
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => module,
    });

    ticker.start(60_000);
    ticker.start(60_000);

    expect(module.start).toHaveBeenCalledTimes(2);
  });

  it('isRunning delegates straight to the native module on every call, not a local flag', () => {
    // A headless caller (e.g. the background-task's ticking gate) never shares the JS object a
    // live adapter created, so isRunning() must read the real native state fresh each time
    // instead of a closure flag that would always start false in a different instance.
    const module = buildNativeModule({ isRunning: jest.fn().mockReturnValue(true) });
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => module,
    });

    expect(ticker.isRunning()).toBe(true);
    expect(module.isRunning).toHaveBeenCalledTimes(1);
  });

  it('treats an unexpected native module lookup error as unavailable instead of throwing', () => {
    const ticker = createNativeForegroundSyncTicker({
      requireOptionalNativeModule: () => {
        throw new Error('bridge not ready');
      },
    });

    expect(() => ticker.start(60_000)).not.toThrow();
    expect(ticker.isRunning()).toBe(false);
  });
});
