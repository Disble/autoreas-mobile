import { loadCachedNativeModule } from '../../src/infrastructure/db/native-runtime/native-runtime.helpers';

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
