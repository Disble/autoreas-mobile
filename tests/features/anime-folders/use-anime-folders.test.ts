import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useAnimeFolders } from '../../../src/features/anime-folders/use-anime-folders';
import * as store from '../../../src/features/anime-folders/anime-folders.store';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  useOptionalSQLiteContext: jest.fn(),
  useOptionalLiveQuery: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  createDrizzleDb: jest.fn(() => ({
    select: () => ({ from: () => ({ limit: () => 'app-preferences-query' }) }),
  })),
}));

jest.mock('../../../src/features/anime-folders/anime-folders.store', () => ({
  ...jest.requireActual('../../../src/features/anime-folders/anime-folders.store'),
  indexAnimeFolders: jest.fn().mockResolvedValue(undefined),
  recheckAnimeFoldersAccess: jest.fn().mockResolvedValue(undefined),
}));

/** Tree uri the picker returns for the SD card anime root. */
const ROOT_URI = 'content://com.android.externalstorage.documents/tree/0123-4567%3AVideos%2FAnime';

/** Mutable preferences the mocked live query returns on every render. */
let world: { rootUri: string | null; status: string };
/** The AppState listener the hook registered, so tests can drive foreground transitions. */
let appStateHandler: ((state: AppStateStatus) => void) | null;

beforeEach(() => {
  jest.clearAllMocks();
  world = { rootUri: ROOT_URI, status: 'loaded' };
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler as (state: AppStateStatus) => void;
    return { remove: jest.fn() };
  });
  (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue({ raw: true });
  (nativeRuntime.useOptionalLiveQuery as jest.Mock).mockImplementation(() => ({
    data: [
      {
        id: 1,
        batteryPromptShownAt: null,
        batteryReminderShownAt: null,
        animeFoldersRootUri: world.rootUri,
        animeFoldersHintDismissedAt: 1000,
      },
    ],
    status: world.status,
  }));
});

describe('useAnimeFolders', () => {
  it('waits for the stored preferences before indexing anything', () => {
    world.status = 'loading';

    const { result } = renderHook(() => useAnimeFolders());

    expect(result.current.isLoaded).toBe(false);
    expect(store.indexAnimeFolders).not.toHaveBeenCalled();
  });

  it('indexes the stored root and labels it', () => {
    const { result } = renderHook(() => useAnimeFolders());

    expect(store.indexAnimeFolders).toHaveBeenCalledWith(ROOT_URI);
    expect(result.current).toMatchObject({
      isLoaded: true,
      rootLabel: 'SD card › Videos › Anime',
      hintDismissedAt: 1000,
    });
  });

  it('indexes again when the stored root changes, and clears it when there is none', () => {
    const { rerender } = renderHook(() => useAnimeFolders());
    world.rootUri = null;

    rerender({});

    expect(store.indexAnimeFolders).toHaveBeenLastCalledWith(null);
  });

  it('forces a refresh of the stored root on reindex', () => {
    const { result } = renderHook(() => useAnimeFolders());

    act(() => {
      result.current.reindex();
    });

    expect(store.indexAnimeFolders).toHaveBeenLastCalledWith(ROOT_URI, true);
  });

  it('only re-checks access when the app returns to the foreground', () => {
    renderHook(() => useAnimeFolders());
    (store.indexAnimeFolders as jest.Mock).mockClear();

    act(() => {
      appStateHandler?.('background');
      appStateHandler?.('active');
    });

    expect(store.recheckAnimeFoldersAccess).toHaveBeenCalledTimes(1);
    expect(store.indexAnimeFolders).not.toHaveBeenCalled();
  });
});
