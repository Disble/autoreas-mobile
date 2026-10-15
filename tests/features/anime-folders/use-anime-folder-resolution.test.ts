import { renderHook } from '@testing-library/react-native';
import { buildFolderIndex } from '../../../src/features/anime-folders/anime-folders.helpers';
import type { AnimeFoldersView } from '../../../src/features/anime-folders/anime-folders.types';
import { useAnimeFolderResolution } from '../../../src/features/anime-folders/use-anime-folder-resolution';
import { useAnimeFolders } from '../../../src/features/anime-folders/use-anime-folders';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  useOptionalSQLiteContext: jest.fn(() => ({ raw: true })),
  useOptionalLiveQuery: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  createDrizzleDb: jest.fn(() => ({
    select: () => ({ from: () => 'all-animes-query' }),
  })),
}));

jest.mock('../../../src/features/anime-folders/use-anime-folders', () => ({
  useAnimeFolders: jest.fn(),
}));

/** Index of the SD card anime root holding two folders. */
const INDEX = buildFolderIndex(
  ['Bleach', 'Dandadan'].map((relativePath) => ({
    relativePath,
    documentId: `0123-4567:Videos/Anime/${relativePath}`,
  })),
);

/** Mocks the shared folder index the hook resolves against. */
function givenIndex(index: AnimeFoldersView['index']) {
  jest.mocked(useAnimeFolders).mockReturnValue({ index } as AnimeFoldersView);
}

beforeEach(() => {
  jest.mocked(nativeRuntime.useOptionalLiveQuery).mockReturnValue({
    data: [
      { id: 'a1', carpeta: 'D:/Anime/Bleach', folderRelative: null },
      { id: 'a2', carpeta: 'D:/Anime/Naruto', folderRelative: null },
    ],
    status: 'loaded',
  });
});

describe('useAnimeFolderResolution', () => {
  it('resolves every stored anime, active or not, against the shared index', () => {
    givenIndex(INDEX);

    const { result } = renderHook(() => useAnimeFolderResolution());

    expect(nativeRuntime.useOptionalLiveQuery).toHaveBeenCalledWith('all-animes-query', []);
    expect(result.current?.byAnimeId.get('a1')?.folder.devicePath).toBe(
      '/storage/0123-4567/Videos/Anime/Bleach',
    );
    expect(result.current?.byAnimeId.has('a2')).toBe(false);
  });

  it('resolves nothing until an index exists', () => {
    givenIndex(null);

    const { result } = renderHook(() => useAnimeFolderResolution());

    expect(result.current).toBeNull();
  });
});
