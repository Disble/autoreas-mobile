import { render } from '@testing-library/react-native';
import { AnimeFoldersDetailContent } from '../../../src/features/anime-folders/ui/AnimeFoldersDetailScreen/AnimeFoldersDetailScreen';
import type { AnimeFoldersDetailView } from '../../../src/features/anime-folders/ui/AnimeFoldersDetailScreen/anime-folders-detail-screen.types';

/** The real scroll view reads safe-area insets and the header height from providers. */
jest.mock('../../../src/components/screen-scroll-view', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native') as typeof import('react-native');
  return { ScreenScrollView: View };
});

/** Detail of the device baseline, trimmed to one folder per list. */
const VIEW: AnimeFoldersDetailView = {
  totals: { folders: 24, withAnime: 22, withoutAnime: 1 },
  unmatchedTitle: 'SIN ANIME · 1',
  unmatchedFolders: ['Suzumiya Haruhi no Yuuutsu BD Castellano'],
  sharedTitle: 'CON MÁS DE UN ANIME · 0',
  sharedFolders: [],
  matchedTitle: 'CON ANIME · 22',
  matchedFolders: [{ name: 'Date a Live', methodLabel: 'nombre exacto' }],
};

/** The same detail with one folder two animes resolve to. */
const SHARED_VIEW: AnimeFoldersDetailView = {
  ...VIEW,
  sharedTitle: 'CON MÁS DE UN ANIME · 1',
  sharedFolders: ['Bleach'],
};

describe('AnimeFoldersDetailContent', () => {
  it('shows the totals, the three lists and the canvas copy', () => {
    const { getByText } = render(
      <AnimeFoldersDetailContent
        rootLabel="SD card › Videos › Anime"
        view={VIEW}
        statusLabel=""
        isWide
      />,
    );

    expect(getByText('EN ESTA TABLET')).toBeTruthy();
    expect(getByText('24')).toBeTruthy();
    expect(getByText('carpetas')).toBeTruthy();
    expect(getByText('22')).toBeTruthy();
    expect(getByText('con anime')).toBeTruthy();
    expect(getByText('1')).toBeTruthy();
    expect(getByText('sin anime')).toBeTruthy();
    expect(getByText('SIN ANIME · 1')).toBeTruthy();
    expect(getByText('Suzumiya Haruhi no Yuuutsu BD Castellano')).toBeTruthy();
    expect(
      getByText(
        'Ningún anime de la PC usa una carpeta con este nombre. Si debería tener uno, revisa su carpeta en Autoreas Bridge.',
      ),
    ).toBeTruthy();
    expect(
      getByText(
        'Ninguna. Si dos animes comparten el nombre de una carpeta, aparecen aquí y ninguno muestra el botón hasta que se distinga en la PC.',
      ),
    ).toBeTruthy();
    expect(getByText('CON ANIME · 22')).toBeTruthy();
    expect(getByText('nombre exacto')).toBeTruthy();
  });

  it('lists the shared folders above the explanation', () => {
    const { getByText, queryByText } = render(
      <AnimeFoldersDetailContent
        rootLabel="SD card › Videos › Anime"
        view={SHARED_VIEW}
        statusLabel=""
        isWide={false}
      />,
    );

    expect(getByText('Bleach')).toBeTruthy();
    expect(
      getByText(
        'Si dos animes comparten el nombre de una carpeta, aparecen aquí y ninguno muestra el botón hasta que se distinga en la PC.',
      ),
    ).toBeTruthy();
    expect(queryByText(/^Ninguna\./)).toBeNull();
  });

  it('shows only the status while there is no index', () => {
    const { getByText, queryByText } = render(
      <AnimeFoldersDetailContent
        rootLabel="SD card › Videos › Anime"
        view={null}
        statusLabel="No se puede leer la carpeta"
        isWide={false}
      />,
    );

    expect(getByText('No se puede leer la carpeta')).toBeTruthy();
    expect(queryByText(/^CON ANIME/)).toBeNull();
  });
});
