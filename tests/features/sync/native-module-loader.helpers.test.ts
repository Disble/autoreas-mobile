import { loadOptionalNativeModule } from '../../../src/features/sync/native-module-loader/native-module-loader.helpers';
import type { OptionalNativeModuleLoader } from '../../../src/features/sync/native-module-loader/native-module-loader.types';

describe('native-module-loader degradation warning', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete (globalThis as { __nativeSyncSeamsWarned?: Record<string, boolean> })
      .__nativeSyncSeamsWarned;
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('emite el aviso de logcat cuando el core es unavailable', () => {
    const nativeModule = loadOptionalNativeModule(null, 'SyncTicker');

    expect(nativeModule).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[nativeSeam] SyncTicker unavailable (expo-modules-core is unavailable); this seam degrades to a no-op',
    );
  });

  it('nombra la ausencia del módulo nativo con su causa propia', () => {
    const loader: OptionalNativeModuleLoader<{ ping: () => void }> = () => null;

    expect(loadOptionalNativeModule(loader, 'SyncEngine')).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[nativeSeam] SyncEngine unavailable (the native module is missing); this seam degrades to a no-op',
    );
  });

  it('nombra un lookup de puente nativo que lanza, sin propagarlo', () => {
    const loader: OptionalNativeModuleLoader<{ ping: () => void }> = () => {
      throw new Error('boom');
    };

    expect(loadOptionalNativeModule(loader, 'SyncJournal')).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[nativeSeam] SyncJournal unavailable (the native-bridge lookup threw); this seam degrades to a no-op',
    );
  });

  it('avisa una sola vez por runtime y por módulo', () => {
    loadOptionalNativeModule(null, 'SyncTicker');
    loadOptionalNativeModule(null, 'SyncTicker');

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('un console.warn que lanza no rompe al loader', () => {
    warnSpy.mockImplementationOnce(() => {
      throw new Error('console blew up');
    });

    let nativeModule: unknown;

    expect(() => {
      nativeModule = loadOptionalNativeModule(null, 'SyncTicker');
    }).not.toThrow();
    expect(nativeModule).toBeNull();
  });

  it('devuelve el módulo cuando el loader lo resuelve, sin avisar', () => {
    const module = { ping: () => undefined };
    const loader: OptionalNativeModuleLoader<typeof module> = () => module;

    expect(loadOptionalNativeModule(loader, 'SyncEngine')).toBe(module);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
