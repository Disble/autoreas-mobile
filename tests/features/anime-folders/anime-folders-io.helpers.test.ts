import { Directory } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Alert, Linking } from 'react-native';
import {
  listSafChildren,
  openDeviceFolder,
  openPageUrl,
  pickSafRoot,
} from '../../../src/features/anime-folders/anime-folders-io.helpers';

jest.mock('expo-file-system', () => ({
  Directory: { pickDirectoryAsync: jest.fn() },
}));

jest.mock('expo-intent-launcher', () => ({
  startActivityAsync: jest.fn(),
}));

jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: jest.fn(),
}));

/** Stands in for the native `SafLister.listChildren`. */
const mockListChildren = jest.fn();

/** Picker start location used by these tests. */
const INITIAL_URI =
  'content://com.android.externalstorage.documents/document/0123-4567%3AVideos%2FAnime';

/** Lets the rejection handlers of fire-and-forget calls run. */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

describe('listSafChildren', () => {
  /** A child folder uri inside the SD card anime root tree. */
  const CHILD_URI =
    'content://com.android.externalstorage.documents/tree/0123-4567%3AVideos%2FAnime/document/0123-4567%3AVideos%2FAnime%2FBleach';

  it('lists the folder through the native lister, one call per folder', async () => {
    jest.mocked(requireOptionalNativeModule).mockReturnValue({ listChildren: mockListChildren });
    mockListChildren.mockResolvedValue([{ uri: CHILD_URI, isDirectory: true }]);

    await expect(listSafChildren(INITIAL_URI)).resolves.toEqual([{ uri: CHILD_URI, isDirectory: true }]);
    expect(requireOptionalNativeModule).toHaveBeenCalledWith('SafLister');
    expect(mockListChildren).toHaveBeenCalledTimes(1);
    expect(mockListChildren).toHaveBeenCalledWith(INITIAL_URI);
  });

  it('rejects when access to the folder was lost', async () => {
    jest.mocked(requireOptionalNativeModule).mockReturnValue({ listChildren: mockListChildren });
    mockListChildren.mockRejectedValue(new Error('permission revoked'));

    await expect(listSafChildren(INITIAL_URI)).rejects.toThrow('permission revoked');
  });

  it('rejects when the native lister is not in this build', async () => {
    jest.mocked(requireOptionalNativeModule).mockReturnValue(null);

    await expect(listSafChildren(INITIAL_URI)).rejects.toThrow('SafLister');
  });
});

describe('pickSafRoot', () => {
  it('opens the picker at the given folder and returns the chosen tree uri', async () => {
    jest
      .mocked(Directory.pickDirectoryAsync)
      .mockResolvedValue({ uri: 'content://tree/x' } as Directory);

    await expect(pickSafRoot(INITIAL_URI)).resolves.toBe('content://tree/x');
    expect(Directory.pickDirectoryAsync).toHaveBeenCalledWith(INITIAL_URI);
  });

  it('returns null when the user cancels', async () => {
    jest.mocked(Directory.pickDirectoryAsync).mockRejectedValue(new Error('cancelled'));

    await expect(pickSafRoot(INITIAL_URI)).resolves.toBeNull();
  });
});

describe('openDeviceFolder', () => {
  it('opens My Files at the path, adjacent in split screen', () => {
    jest.mocked(startActivityAsync).mockResolvedValue({ resultCode: 0 } as never);

    openDeviceFolder('/storage/0123-4567/Videos/Anime/Bleach');

    expect(startActivityAsync).toHaveBeenCalledWith(
      'samsung.myfiles.intent.action.LAUNCH_MY_FILES',
      {
        extra: {
          'samsung.myfiles.intent.extra.START_PATH': '/storage/0123-4567/Videos/Anime/Bleach',
        },
        flags: 0x10000000 | 0x00001000,
      },
    );
  });

  it('tells the user when My Files cannot open it', async () => {
    jest.mocked(startActivityAsync).mockRejectedValue(new Error('No Activity found'));

    openDeviceFolder('/storage/0123-4567/Videos/Anime/Bleach');
    await flushPromises();

    expect(Alert.alert).toHaveBeenCalledWith(
      'No se pudo abrir la carpeta',
      'Error: No Activity found',
    );
  });
});

describe('openPageUrl', () => {
  it('opens the page in the browser, and tells the user when it cannot', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no browser'));

    openPageUrl('https://jkanime.net/bleach/');
    await flushPromises();

    expect(openURL).toHaveBeenCalledWith('https://jkanime.net/bleach/');
    expect(Alert.alert).toHaveBeenCalledWith('No se pudo abrir la página', 'Error: no browser');
  });
});
