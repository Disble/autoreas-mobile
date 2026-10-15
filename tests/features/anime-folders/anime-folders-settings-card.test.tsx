import { act, renderHook } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { useToast } from 'heroui-native';
import { buildFolderIndex, resolveAnimeFolders } from '../../../src/features/anime-folders/anime-folders.helpers';
import type { AnimeFoldersView, FolderResolution } from '../../../src/features/anime-folders/anime-folders.types';
import { useAnimeFoldersSettingsCard } from '../../../src/features/anime-folders/ui/AnimeFoldersSettingsCard/use-anime-folders-settings-card';
import { useAnimeFolderResolution } from '../../../src/features/anime-folders/use-anime-folder-resolution';
import { useAnimeFolders } from '../../../src/features/anime-folders/use-anime-folders';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('heroui-native', () => ({
  ...jest.requireActual('heroui-native'),
  useToast: jest.fn(),
}));

jest.mock('../../../src/features/anime-folders/use-anime-folders', () => ({
  useAnimeFolders: jest.fn(),
}));

jest.mock('../../../src/features/anime-folders/use-anime-folder-resolution', () => ({
  useAnimeFolderResolution: jest.fn(),
}));

/** Tree uri the picker returns for the SD card anime root. */
const ROOT_URI = 'content://com.android.externalstorage.documents/tree/0123-4567%3AVideos%2FAnime';

/** Resolution with two animes opening Bleach and Dandadan, and Haruhi without anime. */
const RESOLUTION: FolderResolution = resolveAnimeFolders(
  buildFolderIndex(
    ['Bleach', 'Dandadan', 'Haruhi BD'].map((relativePath) => ({
      relativePath,
      documentId: `0123-4567:Videos/Anime/${relativePath}`,
    })),
  ),
  [
    { id: 'a1', carpeta: 'D:/Anime/Bleach', folderRelative: null },
    { id: 'a2', carpeta: 'D:/Anime/Dandadan', folderRelative: null },
  ],
);

/** Spies standing in for the toast and the router. */
const toast = { show: jest.fn() };
/** Router spy; only `push` is used. */
const router = { push: jest.fn() };

/** Builds the folders view the mocked hook returns: a readable, indexed root. */
function view(overrides: Partial<AnimeFoldersView> = {}): AnimeFoldersView {
  return {
    rootUri: ROOT_URI,
    status: 'ready',
    index: null,
    indexedAt: Date.now(),
    isLoaded: true,
    rootLabel: 'SD card › Videos › Anime',
    hintDismissedAt: null,
    reindex: jest.fn(),
    chooseRoot: jest.fn().mockResolvedValue(ROOT_URI),
    dismissHint: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useToast).mockReturnValue({ toast } as unknown as ReturnType<typeof useToast>);
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useAnimeFolderResolution).mockReturnValue(RESOLUTION);
});

describe('useAnimeFoldersSettingsCard', () => {
  it('confirms once, with the count, after the chosen folder is indexed', async () => {
    let folders = view({ status: 'indexing' });
    jest.mocked(useAnimeFolders).mockImplementation(() => folders);
    const { result, rerender } = renderHook(() => useAnimeFoldersSettingsCard());

    await act(async () => {
      result.current.handleChooseRoot();
    });
    expect(toast.show).not.toHaveBeenCalled();

    folders = view({ status: 'ready' });
    rerender({});
    rerender({});

    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith({
      variant: 'success',
      label: 'Listo: 2 animes ya abren su carpeta desde la tarjeta.',
    });
  });

  it('does not confirm again when the folder is searched again later', async () => {
    let folders = view({ status: 'indexing' });
    jest.mocked(useAnimeFolders).mockImplementation(() => folders);
    const { result, rerender } = renderHook(() => useAnimeFoldersSettingsCard());

    await act(async () => {
      result.current.handleChooseRoot();
    });
    folders = view({ status: 'ready' });
    rerender({});
    folders = view({ status: 'indexing' });
    rerender({});
    folders = view({ status: 'ready' });
    rerender({});

    expect(toast.show).toHaveBeenCalledTimes(1);
  });

  it('waits for the index of the chosen folder, not the one still shown', async () => {
    let folders = view({ rootUri: 'content://previous-root', status: 'ready' });
    jest.mocked(useAnimeFolders).mockImplementation(() => folders);
    const { result, rerender } = renderHook(() => useAnimeFoldersSettingsCard());

    await act(async () => {
      result.current.handleChooseRoot();
    });
    rerender({});
    expect(toast.show).not.toHaveBeenCalled();

    folders = view({ status: 'ready' });
    rerender({});
    expect(toast.show).toHaveBeenCalledTimes(1);
  });

  it('confirms nothing when the picker is cancelled', async () => {
    jest
      .mocked(useAnimeFolders)
      .mockReturnValue(view({ chooseRoot: jest.fn().mockResolvedValue(null) }));
    const { result, rerender } = renderHook(() => useAnimeFoldersSettingsCard());

    await act(async () => {
      result.current.handleChooseRoot();
    });
    rerender({});

    expect(toast.show).not.toHaveBeenCalled();
  });

  it('confirms nothing when the chosen folder cannot be read', async () => {
    let folders = view({ status: 'indexing' });
    jest.mocked(useAnimeFolders).mockImplementation(() => folders);
    const { result, rerender } = renderHook(() => useAnimeFoldersSettingsCard());

    await act(async () => {
      result.current.handleChooseRoot();
    });
    folders = view({ status: 'lost' });
    rerender({});
    folders = view({ status: 'ready' });
    rerender({});

    expect(toast.show).not.toHaveBeenCalled();
  });

  it('opens the detail screen and re-indexes from the card', () => {
    const folders = view();
    jest.mocked(useAnimeFolders).mockReturnValue(folders);
    const { result } = renderHook(() => useAnimeFoldersSettingsCard());

    result.current.handleOpenDetail();
    result.current.handleReindex();

    expect(router.push).toHaveBeenCalledWith('/anime-folders');
    expect(folders.reindex).toHaveBeenCalledTimes(1);
  });
});
