import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { AnimeFolderBanner } from '../../../src/features/anime-folders/ui/AnimeFolderBanner/AnimeFolderBanner';
import { getAnimeFolderBannerKind } from '../../../src/features/anime-folders/ui/AnimeFolderBanner/anime-folder-banner.helpers';
import { useAnimeFolderBanner } from '../../../src/features/anime-folders/ui/AnimeFolderBanner/use-anime-folder-banner';
import { useAnimeFolders } from '../../../src/features/anime-folders/use-anime-folders';
import type { AnimeFoldersView } from '../../../src/features/anime-folders/anime-folders.types';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../../src/features/anime-folders/use-anime-folders', () => ({
  useAnimeFolders: jest.fn(),
}));

jest.mock('../../../src/features/anime-folders/ui/AnimeFolderSetupSheet', () => ({
  AnimeFolderSetupSheet: jest.fn(() => null),
}));

/** The mocked setup sheet, to read the props the banner passes it. */
const mockSetupSheet = jest.requireMock(
  '../../../src/features/anime-folders/ui/AnimeFolderSetupSheet',
).AnimeFolderSetupSheet as jest.Mock;

/** Builds the folders view the mocked hook returns: preferences read, no root, hint not dismissed. */
function view(overrides: Partial<AnimeFoldersView> = {}): AnimeFoldersView {
  return {
    rootUri: null,
    status: 'idle',
    index: null,
    indexedAt: null,
    isLoaded: true,
    rootLabel: null,
    hintDismissedAt: null,
    reindex: jest.fn(),
    chooseRoot: jest.fn().mockResolvedValue(null),
    dismissHint: jest.fn(),
    ...overrides,
  };
}

/** Props the setup sheet received on its latest render. */
function lastSheetProps() {
  return mockSetupSheet.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getAnimeFolderBannerKind', () => {
  /** Inputs of a fresh install: preferences read, no root, hint never dismissed. */
  const fresh = { isLoaded: true, status: 'idle', hasRoot: false, hintDismissedAt: null } as const;

  it('shows the hint only while no root is set and it was never dismissed', () => {
    expect(getAnimeFolderBannerKind(fresh)).toBe('hint');
    expect(getAnimeFolderBannerKind({ ...fresh, hasRoot: true, status: 'ready' })).toBeNull();
    expect(getAnimeFolderBannerKind({ ...fresh, hintDismissedAt: 1000 })).toBeNull();
  });

  it('shows no hint before the stored preferences are read', () => {
    expect(getAnimeFolderBannerKind({ ...fresh, isLoaded: false })).toBeNull();
  });

  it('shows the lost banner when the root can no longer be read, even with the hint dismissed', () => {
    expect(
      getAnimeFolderBannerKind({ ...fresh, hasRoot: true, status: 'lost', hintDismissedAt: 1000 }),
    ).toBe('lost');
  });
});

describe('useAnimeFolderBanner', () => {
  it('opens the setup sheet only from the hint, and choosing there closes it and opens the picker', () => {
    const folders = view();
    jest.mocked(useAnimeFolders).mockReturnValue(folders);
    const { result } = renderHook(() => useAnimeFolderBanner());

    expect(result.current.isSetupSheetOpen).toBe(false);

    act(() => result.current.handleOpenSetupSheet());
    expect(result.current.isSetupSheetOpen).toBe(true);

    act(() => result.current.handleChooseFromSheet());
    expect(result.current.isSetupSheetOpen).toBe(false);
    expect(folders.chooseRoot).toHaveBeenCalledTimes(1);
  });

  it('closes the sheet on "Ahora no" without choosing', () => {
    const folders = view();
    jest.mocked(useAnimeFolders).mockReturnValue(folders);
    const { result } = renderHook(() => useAnimeFolderBanner());

    act(() => result.current.handleOpenSetupSheet());
    act(() => result.current.handleCloseSetupSheet());

    expect(result.current.isSetupSheetOpen).toBe(false);
    expect(folders.chooseRoot).not.toHaveBeenCalled();
  });
});

describe('AnimeFolderBanner', () => {
  it('shows the hint; "Ahora no" dismisses it and "Elegir carpeta" opens the setup sheet', () => {
    const folders = view();
    jest.mocked(useAnimeFolders).mockReturnValue(folders);
    const { getByText } = render(<AnimeFolderBanner />);

    expect(getByText('Abre la carpeta de cada anime desde la tablet')).toBeTruthy();
    expect(
      getByText('Elige una vez dónde guardas los animes. Autoreas solo lee los nombres de las carpetas.'),
    ).toBeTruthy();
    expect(lastSheetProps().isOpen).toBe(false);

    fireEvent.press(getByText('Ahora no'));
    expect(folders.dismissHint).toHaveBeenCalledTimes(1);

    fireEvent.press(getByText('Elegir carpeta'));
    expect(lastSheetProps().isOpen).toBe(true);
    expect(folders.chooseRoot).not.toHaveBeenCalled();
  });

  it('shows the lost banner, whose action goes straight to the picker', () => {
    const folders = view({ status: 'lost', rootLabel: 'SD card › Videos › Anime' });
    jest.mocked(useAnimeFolders).mockReturnValue(folders);
    const { getByText, queryByText } = render(<AnimeFolderBanner />);

    expect(getByText('No se puede leer la carpeta de anime')).toBeTruthy();
    expect(
      getByText(
        'La tarjeta SD no está o Android quitó el permiso. Los botones de carpeta vuelven cuando la elijas de nuevo.',
      ),
    ).toBeTruthy();
    expect(queryByText('Ahora no')).toBeNull();

    fireEvent.press(getByText('Elegir de nuevo'));
    expect(folders.chooseRoot).toHaveBeenCalledTimes(1);
  });

  it('shows nothing once a readable root is set', () => {
    jest
      .mocked(useAnimeFolders)
      .mockReturnValue(view({ status: 'ready', rootLabel: 'SD card › Videos › Anime' }));
    const { queryByText } = render(<AnimeFolderBanner />);

    expect(queryByText('Abre la carpeta de cada anime desde la tablet')).toBeNull();
    expect(queryByText('No se puede leer la carpeta de anime')).toBeNull();
  });
});
