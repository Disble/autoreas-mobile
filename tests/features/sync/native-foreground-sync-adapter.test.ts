import notifee, { AuthorizationStatus } from 'react-native-notify-kit';
import { Platform } from 'react-native';
import { createNativeForegroundSyncAdapter } from '../../../src/features/sync/native-foreground-sync-adapter';
import {
  FOREGROUND_SYNC_INTERVAL_MS,
  SYNC_FOREGROUND_SERVICE_CHANNEL_ID,
} from '../../../src/features/sync/native-foreground-sync-adapter/native-foreground-sync-adapter.constants';

/** Mock for the native ticker's start(); receives the tick interval in milliseconds. */
const mockTickerStart = jest.fn<void, [number]>();
/** Mock for the native ticker's stop(). */
const mockTickerStop = jest.fn<void, []>();
/** Mock for the native ticker's isRunning(). */
const mockTickerIsRunning = jest.fn<boolean, []>();
/** Mock for the native presence seam's isForegroundServiceRunning(). */
const mockPresenceIsRunning = jest.fn<boolean, [string]>();
/** Mock for the battery-optimization exemption seam's isExempt(). */
const mockIsExempt = jest.fn<boolean, []>();

jest.mock('../../../src/features/sync/native-foreground-sync-ticker.helpers', () => ({
  createNativeForegroundSyncTicker: jest.fn(() => ({
    start: mockTickerStart,
    stop: mockTickerStop,
    isRunning: mockTickerIsRunning,
  })),
}));

jest.mock('../../../src/features/sync/native-foreground-service-presence.helpers', () => ({
  createNativeForegroundServicePresence: jest.fn(() => ({
    isForegroundServiceRunning: mockPresenceIsRunning,
  })),
}));

jest.mock('../../../src/features/sync/native-battery-optimization.helpers', () => ({
  createNativeBatteryOptimizationExemption: jest.fn(() => ({
    isExempt: mockIsExempt,
    requestExemption: jest.fn(),
  })),
}));

describe('native-foreground-sync-adapter', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');

  /** Puts the adapter on Android with notification permission resolved to the given status. */
  function authorizeAndroid(authorizationStatus = AuthorizationStatus.AUTHORIZED) {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    (notifee.requestPermission as jest.Mock).mockResolvedValue({ authorizationStatus });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockTickerIsRunning.mockReturnValue(false);
    mockPresenceIsRunning.mockReturnValue(false);
    mockIsExempt.mockReturnValue(false);
  });

  afterEach(() => {
    if (platformDescriptor) {
      Object.defineProperty(Platform, 'OS', platformDescriptor);
    }
  });

  it('returns unsupported status outside Android', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    mockIsExempt.mockReturnValue(true);

    const adapter = createNativeForegroundSyncAdapter();

    await expect(adapter.getStatus()).resolves.toEqual({
      registrationStatus: 'unsupported',
      executionMode: 'best_effort_background_task',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: false,
      isBackgroundTaskRegistered: false,
      isBatteryOptimizationExempt: true,
    });
    expect(mockPresenceIsRunning).not.toHaveBeenCalled();
  });

  it('register() starts native ticking at the foreground sync interval on Android', async () => {
    authorizeAndroid();

    const adapter = createNativeForegroundSyncAdapter();

    await adapter.register();

    expect(mockTickerStart).toHaveBeenCalledWith(FOREGROUND_SYNC_INTERVAL_MS);
  });

  it('register() is a no-op outside Android', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });

    const adapter = createNativeForegroundSyncAdapter();

    await adapter.register();

    expect(mockTickerStart).not.toHaveBeenCalled();
  });

  it('register() calls start() again on a second call, relying on native idempotency', async () => {
    // "App open while the mode is on calls start() again": no JS-level guard here, native
    // startTicking() already stops then restarts safely (T4).
    authorizeAndroid();

    const adapter = createNativeForegroundSyncAdapter();

    await adapter.register();
    await adapter.register();

    expect(mockTickerStart).toHaveBeenCalledTimes(2);
  });

  it('unregister() stops native ticking on Android', async () => {
    authorizeAndroid();

    const adapter = createNativeForegroundSyncAdapter();

    await adapter.register();
    await adapter.unregister();

    expect(mockTickerStop).toHaveBeenCalledTimes(1);
  });

  it('unregister() is a no-op outside Android', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });

    const adapter = createNativeForegroundSyncAdapter();

    await adapter.unregister();

    expect(mockTickerStop).not.toHaveBeenCalled();
  });

  it('getStatus() reports live presence read from the native SyncForegroundService channel', async () => {
    authorizeAndroid();
    mockPresenceIsRunning.mockReturnValue(true);
    mockIsExempt.mockReturnValue(true);

    const adapter = createNativeForegroundSyncAdapter();

    await adapter.register();

    await expect(adapter.getStatus()).resolves.toEqual({
      registrationStatus: 'registered',
      executionMode: 'android_foreground_service',
      isForegroundServiceRunning: true,
      canShowPersistentNotification: true,
      isBackgroundTaskRegistered: false,
      isBatteryOptimizationExempt: true,
    });
    expect(mockPresenceIsRunning).toHaveBeenCalledWith(SYNC_FOREGROUND_SERVICE_CHANNEL_ID);
  });

  it('getStatus() reports unregistered when native presence is absent', async () => {
    authorizeAndroid();
    mockPresenceIsRunning.mockReturnValue(false);

    const adapter = createNativeForegroundSyncAdapter();

    await adapter.register();
    await adapter.unregister();

    await expect(adapter.getStatus()).resolves.toEqual({
      registrationStatus: 'unregistered',
      executionMode: 'android_foreground_service',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: true,
      isBackgroundTaskRegistered: false,
      isBatteryOptimizationExempt: false,
    });
  });

  it('getStatus() reports no persistent notification before register() ever ran', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });

    const adapter = createNativeForegroundSyncAdapter();

    await expect(adapter.getStatus()).resolves.toEqual(
      expect.objectContaining({ canShowPersistentNotification: false }),
    );
  });

  it('getStatus() reports no persistent notification when permission is denied', async () => {
    authorizeAndroid(AuthorizationStatus.DENIED);

    const adapter = createNativeForegroundSyncAdapter();

    await adapter.register();

    await expect(adapter.getStatus()).resolves.toEqual(
      expect.objectContaining({ canShowPersistentNotification: false }),
    );
  });

  it('exposes the android_foreground_service mode literal', () => {
    const adapter = createNativeForegroundSyncAdapter();

    expect(adapter.mode).toBe('android_foreground_service');
  });

  it('reads the battery-optimization exemption fresh on every getStatus() call', async () => {
    authorizeAndroid();
    mockIsExempt.mockReturnValueOnce(false).mockReturnValueOnce(true);

    const adapter = createNativeForegroundSyncAdapter();

    const first = await adapter.getStatus();
    const second = await adapter.getStatus();

    expect(first.isBatteryOptimizationExempt).toBe(false);
    expect(second.isBatteryOptimizationExempt).toBe(true);
  });
});
