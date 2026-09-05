import { renderHook } from '@testing-library/react-native';
import { NATIVE_RUNTIME_CACHE } from '../../src/infrastructure/db/native-runtime/native-runtime.constants';
import {
  loadCachedNativeModule,
  useOptionalLiveQuery,
} from '../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import type { DrizzleExpoSQLiteModule } from '../../src/infrastructure/db/native-runtime/native-runtime.types';

/** Seeds the native-runtime cache with a drizzle module whose live query returns a fixed result. */
function stubDrizzleLiveQuery(result: {
  data: unknown;
  updatedAt?: Date;
  error?: unknown;
}): void {
  NATIVE_RUNTIME_CACHE.drizzleExpoSQLite = {
    useLiveQuery: () => result,
  } as unknown as DrizzleExpoSQLiteModule;
}

/** Seeds the native-runtime cache with a drizzle module whose live query throws on read. */
function stubThrowingDrizzleLiveQuery(error: Error): void {
  NATIVE_RUNTIME_CACHE.drizzleExpoSQLite = {
    useLiveQuery: () => {
      throw error;
    },
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

  it('is loaded only once drizzle stamps a real result', () => {
    stubDrizzleLiveQuery({ data: [{ id: 7 }], updatedAt: new Date(1_000) });

    const { result } = renderHook(() => useOptionalLiveQuery<{ id: number }[]>({}, []));

    expect(result.current.data).toEqual([{ id: 7 }]);
    expect(result.current.status).toBe('loaded');
  });

  it('is pending while drizzle still serves its empty seed', () => {
    stubDrizzleLiveQuery({ data: [], updatedAt: undefined });

    const { result } = renderHook(() => useOptionalLiveQuery<{ id: number }[]>({}, []));

    expect(result.current.data).toEqual([]);
    expect(result.current.status).toBe('pending');
  });

  it('is unavailable when the query rejected, so no caller waits on an answer that never comes', () => {
    // drizzle reports a rejected query through `error` and never stamps `updatedAt`, so a
    // pending/loaded split alone would leave the caller waiting for the rest of the session.
    stubDrizzleLiveQuery({ data: [], error: new Error('database is locked') });

    const { result } = renderHook(() => useOptionalLiveQuery<{ id: number }[]>({}, []));

    expect(result.current.status).toBe('unavailable');
  });

  it('is unavailable when the drizzle bindings are absent from the binary', () => {
    NATIVE_RUNTIME_CACHE.drizzleExpoSQLite = null;

    const { result } = renderHook(() => useOptionalLiveQuery<{ id: number }[]>({}, []));

    expect(result.current).toEqual({ data: [], status: 'unavailable' });
  });

  it('is unavailable when reading the query throws a missing-provider error', () => {
    stubThrowingDrizzleLiveQuery(new Error('useSQLiteContext must be used within a SQLiteProvider'));

    const { result } = renderHook(() => useOptionalLiveQuery<{ id: number }[]>({}, []));

    expect(result.current).toEqual({ data: [], status: 'unavailable' });
  });

  it('rethrows an unrelated read failure instead of reporting it as unavailable', () => {
    stubThrowingDrizzleLiveQuery(new Error('Unexpected reader failure'));

    expect(() =>
      renderHook(() => useOptionalLiveQuery<{ id: number }[]>({}, [])),
    ).toThrow('Unexpected reader failure');
  });
});
