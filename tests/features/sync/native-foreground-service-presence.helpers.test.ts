import { createNativeForegroundServicePresence } from '../../../src/features/sync/native-foreground-service-presence.helpers';
import type { NativeForegroundServicePresenceModule } from '../../../src/features/sync/native-foreground-service-presence.types';

describe('native-foreground-service-presence', () => {
  const CHANNEL_ID = 'autoreas-sync-foreground';

  function buildNativeModule(
    overrides: Partial<NativeForegroundServicePresenceModule> = {},
  ): NativeForegroundServicePresenceModule {
    return {
      isForegroundServiceRunning: jest.fn().mockReturnValue(false),
      ...overrides,
    };
  }

  it('degrades to false when the native module is unavailable', () => {
    const presence = createNativeForegroundServicePresence({
      requireOptionalNativeModule: () => null,
    });

    expect(() => presence.isForegroundServiceRunning(CHANNEL_ID)).not.toThrow();
    expect(presence.isForegroundServiceRunning(CHANNEL_ID)).toBe(false);
  });

  it('reports the native presence state through isForegroundServiceRunning', () => {
    const module = buildNativeModule({
      isForegroundServiceRunning: jest.fn().mockReturnValue(true),
    });
    const presence = createNativeForegroundServicePresence({
      requireOptionalNativeModule: () => module,
    });

    expect(presence.isForegroundServiceRunning(CHANNEL_ID)).toBe(true);
    expect(module.isForegroundServiceRunning).toHaveBeenCalledWith(CHANNEL_ID);
  });

  it('passes the given channel id through to the native module unchanged', () => {
    const module = buildNativeModule();
    const presence = createNativeForegroundServicePresence({
      requireOptionalNativeModule: () => module,
    });

    presence.isForegroundServiceRunning('some-other-channel');

    expect(module.isForegroundServiceRunning).toHaveBeenCalledWith('some-other-channel');
  });

  it('treats an unexpected native module lookup error as unavailable instead of throwing', () => {
    const presence = createNativeForegroundServicePresence({
      requireOptionalNativeModule: () => {
        throw new Error('bridge not ready');
      },
    });

    expect(() => presence.isForegroundServiceRunning(CHANNEL_ID)).not.toThrow();
    expect(presence.isForegroundServiceRunning(CHANNEL_ID)).toBe(false);
  });
});
