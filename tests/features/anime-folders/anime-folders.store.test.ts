import type * as StoreModule from '../../../src/features/anime-folders/anime-folders.store';
import type { FolderTreeChild } from '../../../src/features/anime-folders/anime-folders.types';

/** Stands in for the SAF folder listing. */
const mockListSafChildren = jest.fn<Promise<FolderTreeChild[]>, [string]>();
/** Stands in for the SAF root access check. */
const mockIsSafRootReadable = jest.fn<boolean, [string]>();

// The SAF seam is device-only; everything above it (walk, index, single flight) runs for real.
jest.mock('../../../src/features/anime-folders/anime-folders-io.helpers', () => ({
  listSafChildren: (uri: string) => mockListSafChildren(uri),
  isSafRootReadable: (uri: string) => mockIsSafRootReadable(uri),
}));

/** Tree uri the picker returns for the SD card anime root. */
const ROOT_URI = 'content://com.android.externalstorage.documents/tree/0123-4567%3AVideos%2FAnime';
/** A second root, for replacing the chosen one mid-walk. */
const OTHER_ROOT_URI = 'content://com.android.externalstorage.documents/tree/primary%3AMovies';

/** A root holding one folder per name. */
function rootWith(...names: string[]): FolderTreeChild[] {
  return names.map((name) => ({
    uri: `${ROOT_URI}/document/${encodeURIComponent(`0123-4567:Videos/Anime/${name}`)}`,
    isDirectory: true,
  }));
}

/** Loads a fresh store module so each test starts from the initial state. */
function loadStore(): typeof StoreModule {
  let store: typeof StoreModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a synchronous require to get a fresh module instance.
    store = require('../../../src/features/anime-folders/anime-folders.store');
  });

  return store as typeof StoreModule;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockIsSafRootReadable.mockReturnValue(true);
  mockListSafChildren.mockImplementation(async (uri) => (uri === ROOT_URI ? rootWith('Bleach', 'Date a Live') : []));
});

describe('indexAnimeFolders', () => {
  it('indexes the chosen root and reports it ready', async () => {
    const store = loadStore();

    await store.indexAnimeFolders(ROOT_URI);

    const state = store.getAnimeFoldersIndexState();
    expect(state.status).toBe('ready');
    expect(state.index?.folders.map((folder) => folder.name)).toEqual(['Bleach', 'Date a Live']);
    expect(state.indexedAt).not.toBeNull();
  });

  it('runs one walk when several callers ask for the same root at once', async () => {
    const store = loadStore();

    await Promise.all([store.indexAnimeFolders(ROOT_URI), store.indexAnimeFolders(ROOT_URI)]);
    await store.indexAnimeFolders(ROOT_URI);

    expect(mockListSafChildren.mock.calls.filter(([uri]) => uri === ROOT_URI)).toHaveLength(1);
  });

  it('does not start a second walk when a refresh is forced while one is running', async () => {
    const store = loadStore();

    await Promise.all([store.indexAnimeFolders(ROOT_URI), store.indexAnimeFolders(ROOT_URI, true)]);

    expect(mockListSafChildren.mock.calls.filter(([uri]) => uri === ROOT_URI)).toHaveLength(1);
  });

  it('keeps the last known index while a forced refresh runs', async () => {
    const store = loadStore();
    await store.indexAnimeFolders(ROOT_URI);
    const statesDuringRefresh: string[] = [];
    store.subscribeAnimeFoldersIndex(() => {
      const state = store.getAnimeFoldersIndexState();
      statesDuringRefresh.push(`${state.status}:${state.index?.folders.length ?? 'none'}`);
    });

    await store.indexAnimeFolders(ROOT_URI, true);

    expect(statesDuringRefresh).toEqual(['indexing:2', 'ready:2']);
  });

  it('reports the root lost when it can no longer be read', async () => {
    const store = loadStore();
    mockIsSafRootReadable.mockReturnValue(false);

    await store.indexAnimeFolders(ROOT_URI);

    expect(store.getAnimeFoldersIndexState()).toMatchObject({ status: 'lost', index: null });
  });

  it('drops the result of a walk whose root was replaced while it ran', async () => {
    const store = loadStore();

    const first = store.indexAnimeFolders(ROOT_URI);
    const second = store.indexAnimeFolders(OTHER_ROOT_URI);
    await Promise.all([first, second]);

    expect(store.getAnimeFoldersIndexState()).toMatchObject({ rootUri: OTHER_ROOT_URI, status: 'ready' });
    expect(store.getAnimeFoldersIndexState().index?.folders).toEqual([]);
  });

  it('keeps the root chosen again while its first walk is still running', async () => {
    const store = loadStore();

    const first = store.indexAnimeFolders(ROOT_URI);
    await store.indexAnimeFolders(null);
    const again = store.indexAnimeFolders(ROOT_URI);
    await Promise.all([first, again]);

    expect(store.getAnimeFoldersIndexState()).toMatchObject({ rootUri: ROOT_URI, status: 'ready' });
  });

  it('clears the index when no root is chosen', async () => {
    const store = loadStore();
    await store.indexAnimeFolders(ROOT_URI);

    await store.indexAnimeFolders(null);

    expect(store.getAnimeFoldersIndexState()).toMatchObject({ rootUri: null, status: 'idle', index: null });
  });
});

describe('recheckAnimeFoldersAccess', () => {
  it('marks the root lost when the SD card or the grant is gone', async () => {
    const store = loadStore();
    await store.indexAnimeFolders(ROOT_URI);
    mockIsSafRootReadable.mockReturnValue(false);

    await store.recheckAnimeFoldersAccess();

    expect(store.getAnimeFoldersIndexState()).toMatchObject({ status: 'lost', index: null });
  });

  it('re-indexes a lost root once it is readable again, and leaves a ready root alone', async () => {
    const store = loadStore();
    mockIsSafRootReadable.mockReturnValue(false);
    await store.indexAnimeFolders(ROOT_URI);
    mockIsSafRootReadable.mockReturnValue(true);

    await store.recheckAnimeFoldersAccess();
    await store.recheckAnimeFoldersAccess();

    expect(store.getAnimeFoldersIndexState().status).toBe('ready');
    expect(mockListSafChildren.mock.calls.filter(([uri]) => uri === ROOT_URI)).toHaveLength(1);
  });
});
