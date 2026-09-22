import {
  readDiagnosticEvents,
  recordDiagnosticEvent,
  resetDiagnosticEvents,
} from '../../../src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers';
import { loadOptionalNativeModule } from '../../../src/features/sync/native-module-loader/native-module-loader.helpers';
import type { OptionalNativeModuleLoader } from '../../../src/features/sync/native-module-loader/native-module-loader.types';

jest.mock(
  '../../../src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers',
  () => {
    const actual = jest.requireActual<
      typeof import('../../../src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers')
    >('../../../src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers');

    return { ...actual, recordDiagnosticEvent: jest.fn(actual.recordDiagnosticEvent) };
  },
);

/** Typed view of the module-mocked `recordDiagnosticEvent`, letting the shared telemetry suites assert on calls while the real implementation stays wired through the spread. */
const recordMock = jest.mocked(recordDiagnosticEvent);

describe('native-module-loader diagnostic telemetry', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete (globalThis as { __nativeSyncSeamsWarned?: Record<string, boolean> })
      .__nativeSyncSeamsWarned;
    resetDiagnosticEvents();
    recordMock.mockClear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('emite el aviso de logcat Y el evento de telemetría cuando el core es unavailable', () => {
    const nativeModule = loadOptionalNativeModule(null, 'SyncTicker');

    expect(nativeModule).toBeNull();
    // El canal de cable (logcat) sigue vivo: es la señal más temprana con el dispositivo en mano.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[nativeSeam] SyncTicker unavailable'),
    );
    // El canal de producción (anillo -> reconcile) ahora también lo recibe.
    expect(readDiagnosticEvents()).toEqual([
      {
        source: 'native_seam',
        event: 'native_module_unavailable',
        cause: 'expo_modules_core_unavailable',
        firstAt: expect.any(Number),
        lastAt: expect.any(Number),
        count: 1,
      },
    ]);
  });

  it('clasifica la ausencia del módulo nativo con su causa propia', () => {
    const loader: OptionalNativeModuleLoader<{ ping: () => void }> = () => null;

    loadOptionalNativeModule(loader, 'SyncEngine');

    const events = readDiagnosticEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'native_seam',
      event: 'native_module_unavailable',
      cause: 'native_module_missing',
    });
  });

  it('clasifica un lookup de puente nativo que lanza', () => {
    const loader: OptionalNativeModuleLoader<{ ping: () => void }> = () => {
      throw new Error('boom');
    };

    loadOptionalNativeModule(loader, 'SyncJournal');

    const events = readDiagnosticEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'native_seam',
      event: 'native_module_unavailable',
      cause: 'native_bridge_lookup_threw',
    });
  });

  it('graba una sola vez por runtime, igual que el aviso de logcat', () => {
    loadOptionalNativeModule(null, 'SyncTicker');
    loadOptionalNativeModule(null, 'SyncTicker');

    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(readDiagnosticEvents()).toHaveLength(1);
  });

  it('un sink que lanza no rompe al loader', () => {
    recordMock.mockImplementationOnce(() => {
      throw new Error('sink blew up');
    });

    let nativeModule: unknown;

    expect(() => {
      nativeModule = loadOptionalNativeModule(null, 'SyncTicker');
    }).not.toThrow();
    expect(nativeModule).toBeNull();
  });
});
