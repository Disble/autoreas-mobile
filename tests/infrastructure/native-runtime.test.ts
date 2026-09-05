import { renderHook } from '@testing-library/react-native';
import { NATIVE_RUNTIME_CACHE } from '../../src/infrastructure/db/native-runtime/native-runtime.constants';
import {
  loadCachedNativeModule,
  useOptionalLiveQuery,
} from '../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import type { DrizzleExpoSQLiteModule } from '../../src/infrastructure/db/native-runtime/native-runtime.types';

/** Seeds the native-runtime cache with a drizzle module whose live query returns a fixed result. */
function stubDrizzleLiveQuery(result: { data: unknown; updatedAt?: Date }): void {
  NATIVE_RUNTIME_CACHE.drizzleExpoSQLite = {
    useLiveQuery: () => result,
  } as unknown as DrizzleExpoSQLiteModule;
}

describe('loadCachedNativeModule', () => {
  it('caches unavailable native modules as null without hiding unrelated errors', () => {
    const cacheModule = jest.fn();

    const unavailable = loadCachedNativeModule(
      undefined,
      () => {
        throw new Error('ExpoSQLite is unavailable');
      },
      cacheModule,
    );

    expect(unavailable).toBeNull();
    expect(cacheModule).toHaveBeenCalledWith(null);

    expect(() =>
      loadCachedNativeModule(
        undefined,
        () => {
          throw new Error('Unexpected loader failure');
        },
        cacheModule,
      ),
    ).toThrow('Unexpected loader failure');
  });
});

describe('useOptionalLiveQuery', () => {
  afterEach(() => {
    NATIVE_RUNTIME_CACHE.drizzleExpoSQLite = undefined;
  });

  it('reports the query as not loaded until drizzle stamps a first result', () => {
    stubDrizzleLiveQuery({ data: [], updatedAt: undefined });

    const { result } = renderHook(() => useOptionalLiveQuery<{ id: number }[]>({}, []));

    expect(result.current.data).toEqual([]);
    expect(result.current.hasLoaded).toBe(false);
  });

  it('reports the query as loaded once drizzle stamps a result', () => {
    stubDrizzleLiveQuery({ data: [{ id: 7 }], updatedAt: new Date(1_000) });

    const { result } = renderHook(() => useOptionalLiveQuery<{ id: number }[]>({}, []));

    expect(result.current.data).toEqual([{ id: 7 }]);
    expect(result.current.hasLoaded).toBe(true);
  });

  it('reports the query as not loaded when the native module is unavailable', () => {
    NATIVE_RUNTIME_CACHE.drizzleExpoSQLite = null;

    const { result } = renderHook(() => useOptionalLiveQuery<{ id: number }[]>({}, []));

    expect(result.current).toEqual({ data: [], hasLoaded: false });
  });
});
