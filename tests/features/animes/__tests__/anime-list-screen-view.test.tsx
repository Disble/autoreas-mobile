import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import { Button } from 'heroui-native';
import { AnimeListScreenView } from '../../../../src/features/animes/ui/AnimeListScreen/AnimeListScreen';
import { AnimeListScreenHeaderRight } from '../../../../src/features/animes/ui/AnimeListScreen/AnimeListScreenHeaderRight';
import { AnimeListScreenStatusSection } from '../../../../src/features/animes/ui/AnimeListScreen/AnimeListScreenStatusSection';
import type { AnimeListScreenRenderModel } from '../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen.types';

/** Narrows the render model's item type down to a single anime fixture shape. */
type AnimeListItem = AnimeListScreenRenderModel['animes'][number];

/** Fixture contextual header for the status section test, hoisted so the prop is not a fresh object per render. */
const STATUS_SECTION_CONTEXTUAL_HEADER = {
  title: 'Martes',
  subtitle: '1 anime para ver',
  isToday: true,
};

/** Fixture sync status for the status section test, hoisted so the prop is not a fresh object per render. */
const STATUS_SECTION_SYNC_STATUS: AnimeListScreenRenderModel['syncStatus'] = {
  actionLabel: null,
  chipLabel: 'Catálogo local',
  description: 'La copia local sigue disponible.',
  title: 'Catálogo local listo',
  tone: 'default',
};

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../../../src/features/animes/ui/AnimeCard/AnimeCard', () => ({
  AnimeCard: jest.fn(() => null),
}));

/** Mocks `AnimeCard`, capturing the props AnimeListScreenContent passes down to each rendered card. */
const mockAnimeCard = jest.requireMock(
  '../../../../src/features/animes/ui/AnimeCard/AnimeCard',
).AnimeCard as jest.Mock;

jest.mock('../../../../src/features/animes/ui/AnimeEmptyState', () => ({
  AnimeEmptyState: () => null,
}));

jest.mock('../../../../src/features/animes/ui/AnimeFilterRail', () => ({
  AnimeFilterRail: () => null,
}));

jest.mock('../../../../src/features/animes/ui/AnimeStateSheet', () => ({
  AnimeStateSheet: () => null,
}));

/** Builds a minimal anime list item fixture identified by the given id. */
function buildAnime(id: string): AnimeListItem {
    return {
      _id: id,
      nombre: id,
    estado: 0,
    nrocapvisto: 0,
    totalcap: null,
    dias: [],
    generos: [],
    tipo: null,
    activo: 1,
    primeravez: 0,
    fechaUltCapVisto: null,
    fechaEstreno: null,
    fechaCreacion: null,
    fechaEliminacion: null,
    portada: null,
    pagina: null,
    carpeta: null,
      estudios: null,
      origen: null,
      duracion: null,
      seasonProjection: null,
    };
  }

/** Builds a full AnimeListScreenView render-model fixture, with per-test override seams. */
function buildProps(
  overrides: Partial<AnimeListScreenRenderModel> = {},
): AnimeListScreenRenderModel {
  return {
    animes: [buildAnime('anime-1')],
    filterOptions: [],
    filterCounts: {
      Lunes: 0,
      Martes: 0,
      Miércoles: 0,
      Jueves: 0,
      Viernes: 0,
      Sábado: 0,
      Domingo: 0,
      'Sin ver': 0,
      'Ver hoy': 0,
      Visto: 0,
    },
    contextualHeader: {
      title: 'Martes',
      subtitle: '1 anime para ver',
      isToday: false,
    },
    layoutMode: 'tablet-landscape',
    isMutatingAnimeById: {},
    isDark: false,
    isEmpty: false,
    isRefreshing: false,
    isManualSyncEnabled: true,
    isSeasonMode: false,
    refreshAccessibilityLabel: 'Refrescar Mis Animes',
    syncStatus: {
      actionLabel: null,
      chipLabel: 'Catálogo local',
      description: 'Podés seguir usando esta copia local mientras el bridge no esté disponible.',
      title: 'Catálogo local listo',
      tone: 'default',
    },
    selectedFilter: 'Martes',
    selectedFilterOption: {
      value: 'Martes',
      label: 'Martes',
    },
    settingsHref: '/(tabs)/settings',
    stateSheetRequest: null,
    themeColorForeground: '#ffffff',
    today: 'Viernes',
    handleCapMinus: jest.fn().mockResolvedValue(undefined),
    handleCapMinusHalf: jest.fn().mockResolvedValue(undefined),
    handleCapPlus: jest.fn().mockResolvedValue(undefined),
    handleCapPlusHalf: jest.fn().mockResolvedValue(undefined),
     handleCloseStateSheet: jest.fn(),
      handleCloseSeasonRatingSheet: jest.fn(),
      handleOpenSettings: jest.fn(),
      handleOpenSeasonRatingSheet: jest.fn(),
      handleOpenStateSheet: jest.fn(),
      handleRefresh: jest.fn().mockResolvedValue(undefined),
      handleSelectedFilterChange: jest.fn(),
      handleSeasonRatingSubmit: jest.fn().mockResolvedValue(undefined),
      handleStateSheetSelect: jest.fn().mockResolvedValue(undefined),
      getAnimeCardProps: jest.fn((anime) => ({
        anime,
        isMutating: false,
        onCapMinus: jest.fn(),
        onCapMinusHalf: jest.fn(),
        onCapPlus: jest.fn(),
        onCapPlusHalf: jest.fn(),
        onOpenSeasonRatingSheet: jest.fn(),
        onOpenStateSheet: jest.fn(),
      })),
      seasonRatingSheetRequest: null,
      ...overrides,
    };
  }

describe('AnimeListScreenView', () => {
  it('renders list items through the AnimeCard public contract', () => {
    const props = buildProps();
    mockAnimeCard.mockClear();

    render(<AnimeListScreenView model={props} />);

    expect(mockAnimeCard).toHaveBeenCalled();
    expect(mockAnimeCard.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ anime: props.animes[0] }),
    );
  });

  it('renders season and sync status copy without inventing a missing action', () => {
    const handleOpenSettings = jest.fn();
    const { getByText, queryByText } = render(
      <AnimeListScreenStatusSection
        contextualHeader={STATUS_SECTION_CONTEXTUAL_HEADER}
        isSeasonMode
        syncStatus={STATUS_SECTION_SYNC_STATUS}
        handleOpenSettings={handleOpenSettings}
      />,
    );

    expect(getByText('Modo temporada')).toBeTruthy();
    expect(getByText('Catálogo local listo')).toBeTruthy();
    expect(queryByText('Revisar bridge')).toBeNull();
    expect(handleOpenSettings).not.toHaveBeenCalled();
  });

  it('uses two columns in tablet landscape layout so each card keeps room for its cover, title and actions', () => {
    const { UNSAFE_getByType } = render(<AnimeListScreenView model={buildProps()} />);

    const list = UNSAFE_getByType(FlatList);

    expect(list.props.numColumns).toBe(2);
  });

  it('gives each landscape grid cell a fixed half of the row plus its own gap padding so a lone last card keeps the column width', () => {
    const props = buildProps();
    const { UNSAFE_getByType } = render(<AnimeListScreenView model={props} />);

    const list = UNSAFE_getByType(FlatList);
    const row = list.props.renderItem({ item: props.animes[0] });

    // flex-1 would let the only card of an odd last row grow to the full row width.
    // px-2 replaces columnWrapperClassName="gap-4" so a lone last-row card still gets its own inset.
    expect(row.props.className).toContain('flex-[0.5]');
    expect(row.props.className).toContain('px-2');
    expect(row.props.className).not.toContain('flex-1');
  });

  it('does not use a column wrapper gap, since each cell now carries its own px-2 inset', () => {
    const { UNSAFE_getByType } = render(<AnimeListScreenView model={buildProps()} />);

    const list = UNSAFE_getByType(FlatList);

    expect(list.props.columnWrapperClassName).toBeUndefined();
  });

  it('insets the tablet-landscape content container by px-3 so 12dp plus the cell px-2 aligns with the status banner', () => {
    const { UNSAFE_getByType } = render(
      <AnimeListScreenView model={buildProps({ layoutMode: 'tablet-landscape' })} />,
    );

    const list = UNSAFE_getByType(FlatList);

    expect(list.props.contentContainerClassName).toContain('px-3');
    expect(list.props.contentContainerClassName).not.toContain('px-5');
  });

  it('keeps the phone content container at px-5, matching the status banner inset', () => {
    const { UNSAFE_getByType } = render(
      <AnimeListScreenView model={buildProps({ layoutMode: 'phone' })} />,
    );

    const list = UNSAFE_getByType(FlatList);

    expect(list.props.contentContainerClassName).toContain('px-5');
    expect(list.props.contentContainerClassName).not.toContain('px-3');
  });

  it('triggers the same handleRefresh from pull-to-refresh as the header refresh button', () => {
    const handleRefresh = jest.fn().mockResolvedValue(undefined);
    const { UNSAFE_getByType } = render(
      <AnimeListScreenView model={buildProps({ handleRefresh })} />,
    );

    const list = UNSAFE_getByType(FlatList);
    list.props.refreshControl.props.onRefresh();

    expect(handleRefresh).toHaveBeenCalledTimes(1);
  });

  it('keys each row by the anime `_id`', () => {
    const props = buildProps();
    const { UNSAFE_getByType } = render(<AnimeListScreenView model={props} />);

    const list = UNSAFE_getByType(FlatList);

    expect(list.props.keyExtractor(props.animes[0])).toBe(props.animes[0]._id);
  });

  it('passes mutation state as extraData so visible rows rerender on button lock changes', () => {
    const props = buildProps({
      isMutatingAnimeById: {
        'anime-1': true,
      },
    });
    const { UNSAFE_getByType } = render(<AnimeListScreenView model={props} />);

    const list = UNSAFE_getByType(FlatList);

    expect(list.props.extraData).toBe(props.isMutatingAnimeById);
  });

  it('renders the inline sync status copy above the list', () => {
    const props = buildProps({
      syncStatus: {
        actionLabel: 'Revisar bridge',
        chipLabel: 'Sync pendiente',
        description: 'Tus cambios siguen guardados en este dispositivo. Hace 6 días que el bridge no confirma cambios.',
        title: '2 cambios esperando sync',
        tone: 'danger',
      },
    });

    const { getByText } = render(<AnimeListScreenView model={props} />);

    expect(getByText('Sync pendiente')).toBeTruthy();
    expect(getByText('2 cambios esperando sync')).toBeTruthy();
    expect(getByText('Revisar bridge')).toBeTruthy();
  });

  it('opens settings from the inline sync action when the bridge needs attention', () => {
    const handleOpenSettings = jest.fn();
    const props = buildProps({
      handleOpenSettings,
      syncStatus: {
        actionLabel: 'Revisar bridge',
        chipLabel: 'Sync pendiente',
        description: 'Tus cambios siguen guardados en este dispositivo.',
        title: '2 cambios esperando sync',
        tone: 'warning',
      },
    });

    const { getByText } = render(<AnimeListScreenView model={props} />);

    fireEvent.press(getByText('Revisar bridge'));

    expect(handleOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('shows the season-mode indicator only when season mode is on', () => {
    const { queryByText, rerender } = render(
      <AnimeListScreenView model={buildProps({ isSeasonMode: false })} />,
    );

    expect(queryByText('Modo temporada')).toBeNull();

    rerender(<AnimeListScreenView model={buildProps({ isSeasonMode: true })} />);

    expect(queryByText('Modo temporada')).not.toBeNull();
  });

  it('disables pull to refresh from the same manual-sync gate', () => {
    const { UNSAFE_getByType } = render(
      <AnimeListScreenView model={buildProps({ isManualSyncEnabled: false })} />,
    );

    const list = UNSAFE_getByType(FlatList);

    expect(list.props.refreshControl.props.enabled).toBe(false);
  });

  it('disables the header refresh button from the same manual-sync gate', () => {
    const handleRefresh = jest.fn().mockResolvedValue(undefined);
    const { UNSAFE_getByType } = render(
      <AnimeListScreenHeaderRight
        refreshAccessibilityLabel="Refrescar Mis Animes"
        isRefreshing={false}
        isManualSyncEnabled={false}
        themeColorForeground="#ffffff"
        handleRefresh={handleRefresh}
      />,
    );

    const button = UNSAFE_getByType(Button);

    expect(button.props.isDisabled).toBe(true);
  });
});
