import { fireEvent, render } from '@testing-library/react-native';
import { AnimeFoldersSettingsCardContent } from '../../../src/features/anime-folders/ui/AnimeFoldersSettingsCard/AnimeFoldersSettingsCard';
import type { AnimeFoldersSettingsCardView } from '../../../src/features/anime-folders/ui/AnimeFoldersSettingsCard/anime-folders-settings-card.types';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

/** Card copy of an indexed root with one folder without anime. */
const INDEXED_VIEW: AnimeFoldersSettingsCardView = {
  hasRoot: true,
  rootLabel: 'SD card › Videos › Anime',
  foundLabel: '22 animes con carpeta',
  reviewedLabel: 'hace un momento',
  unmatchedLabel: '1 carpeta sin anime',
};

/** Card copy before a folder is chosen. */
const NO_ROOT_VIEW: AnimeFoldersSettingsCardView = {
  hasRoot: false,
  rootLabel: 'Sin elegir',
  foundLabel: 'Buscando carpetas…',
  reviewedLabel: '—',
  unmatchedLabel: null,
};

describe('AnimeFoldersSettingsCardContent', () => {
  /** Handlers of one render. */
  const handlers = { onOpenDetail: jest.fn(), onReindex: jest.fn(), onChooseRoot: jest.fn() };

  it('shows the folder, what was found, the detail row and both actions', () => {
    const { getByText } = render(<AnimeFoldersSettingsCardContent view={INDEXED_VIEW} {...handlers} />);

    expect(getByText('Carpetas de anime')).toBeTruthy();
    expect(getByText('SD card › Videos › Anime')).toBeTruthy();
    expect(getByText('22 animes con carpeta')).toBeTruthy();
    expect(getByText('hace un momento')).toBeTruthy();

    fireEvent.press(getByText('Ver detalle'));
    fireEvent.press(getByText('Volver a buscar'));
    fireEvent.press(getByText('Cambiar carpeta'));

    expect(handlers.onOpenDetail).toHaveBeenCalledTimes(1);
    expect(handlers.onReindex).toHaveBeenCalledTimes(1);
    expect(handlers.onChooseRoot).toHaveBeenCalledTimes(1);
  });

  it('offers only choosing a folder before one is chosen', () => {
    const { getByText, queryByText } = render(
      <AnimeFoldersSettingsCardContent view={NO_ROOT_VIEW} {...handlers} />,
    );

    expect(getByText('Sin elegir')).toBeTruthy();
    expect(getByText('Elegir carpeta')).toBeTruthy();
    expect(queryByText('Volver a buscar')).toBeNull();
    expect(queryByText('Encontradas')).toBeNull();
    expect(queryByText('Ver detalle')).toBeNull();
  });
});
