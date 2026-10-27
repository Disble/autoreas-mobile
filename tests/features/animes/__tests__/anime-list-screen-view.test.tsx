import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { FlatList, View } from 'react-native';
import { Button } from 'heroui-native';
import { AnimeListScreenView } from '../../../../src/features/animes/ui/AnimeListScreen/AnimeListScreen';
import { AnimeListScreenHeaderRight } from '../../../../src/features/animes/ui/AnimeListScreen/AnimeListScreenHeaderRight';
import { AnimeListScreenListHead } from '../../../../src/features/animes/ui/AnimeListScreen/AnimeListScreenListHead';
import type { AnimeListScreenRenderModel } from '../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen.types';

/** Narrows the render model's item type down to a single anime fixture shape. */
type AnimeListItem = AnimeListScreenRenderModel['animes'][number];

/** Fixture contextual header for the status section test, hoisted so the prop is not a fresh object per render. */
const STATUS_SECTION_CONTEXTUAL_HEADER = {
  title: 'Martes',
  subtitle: '1 anime',
  isToday: true,
};

/** Fixture sync status for the status section test, hoisted so the prop is not a fresh object per render. */
const STATUS_SECTION_SYNC_STATUS: AnimeListScreenRenderModel['syncStatus'] = {
  actionLabel: null,
  chipLabel: 'Nada por enviar',
  description: 'La copia local sigue disponible.',
  kind: 'idle',
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

jest.mock('../../../../src/features/anime-folders/ui/AnimeFolderBanner', () => ({
  AnimeFolderBanner: () => null,
}));

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
      subtitle: '1 anime',
      isToday: false,
    },
    layoutMode: 'tablet-landscape',
    headerLayout: { sideColumnStyle: { width: 240 }, titleStyle: { maxWidth: 800 } },
    bodyStyle: { paddingTop: 64 },
    isDark: false,
    isEmpty: false,
    isRefreshing: false,
    isManualSyncEnabled: true,
    isSeasonMode: false,
    isSyncSheetOpen: false,
    refreshAccessibilityLabel: 'Refrescar Mis Animes',
    syncStatus: {
      actionLabel: null,
      chipLabel: 'Catálogo local',
      description: 'Puedes seguir usando esta copia local mientras el bridge no esté disponible.',
      kind: 'idle',
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
      handleCloseSyncSheet: jest.fn(),
      handleOpenSettings: jest.fn(),
      handleOpenSyncSheet: jest.fn(),
      handleOpenSeasonRatingSheet: jest.fn(),
      handleOpenStateSheet: jest.fn(),
      handleRefresh: jest.fn().mockResolvedValue(undefined),
      handleRefreshPress: jest.fn(),
      handleSelectedFilterChange: jest.fn(),
      handleSeasonRatingSubmit: jest.fn().mockResolvedValue(undefined),
      handleStateSheetSelect: jest.fn().mockResolvedValue(undefined),
      getAnimeListItemProps: jest.fn((anime) => ({
        anime,
        folderPath: null,
        handleCapMinus: jest.fn().mockResolvedValue(undefined),
        handleCapMinusHalf: jest.fn().mockResolvedValue(undefined),
        handleCapPlus: jest.fn().mockResolvedValue(undefined),
        handleCapPlusHalf: jest.fn().mockResolvedValue(undefined),
        handleOpenSeasonRatingSheet: jest.fn(),
        handleOpenStateSheet: jest.fn(),
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

  it('renders the subtitle and season chip but no sync block while the state needs no attention', () => {
    const handleOpenSettings = jest.fn();
    const { getByText, queryByText, queryByTestId } = render(
      <AnimeListScreenListHead
        contextualHeader={STATUS_SECTION_CONTEXTUAL_HEADER}
        isSeasonMode
        syncStatus={STATUS_SECTION_SYNC_STATUS}
        handleOpenSettings={handleOpenSettings}
      />,
    );

    expect(getByText('Modo temporada')).toBeTruthy();
    expect(getByText('1 anime')).toBeTruthy();
    expect(queryByText('Catálogo local listo')).toBeNull();
    expect(queryByTestId('heroui-alert')).toBeNull();
    expect(queryByText('Revisar conexión')).toBeNull();
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

  it('scrolls the list inside a card-radius container with a 16 pt bottom margin', () => {
    const { getByTestId } = render(
      <AnimeListScreenView model={buildProps({ layoutMode: 'phone' })} />,
    );

    const container = getByTestId('anime-list-container');

    expect(container.props.className).toContain('rounded-3xl');
    expect(container.props.className).toContain('overflow-hidden');
    expect(container.props.className).toContain('mb-4');
    expect(container.props.className).not.toContain('-mx-2');
  });

  it('pulls the two-column grid back by the cells\' 8 pt inset so cards meet the container edge', () => {
    const { getByTestId } = render(
      <AnimeListScreenView model={buildProps({ layoutMode: 'tablet-landscape' })} />,
    );

    expect(getByTestId('anime-list-container').props.className).toContain('-mx-2');
  });

  it('starts the panel and the list below the measured header so a taller header never covers the filter panel', () => {
    const { getByTestId } = render(
      <AnimeListScreenView model={buildProps({ layoutMode: 'tablet-landscape', bodyStyle: { paddingTop: 92 } })} />,
    );

    const body = getByTestId('anime-list-screen-body');

    expect(body.props.style).toEqual({ paddingTop: 92 });
    expect(body.props.className).not.toContain('pt-16');
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

  it('hands each row its own props through renderItem instead of re-rendering every row via extraData', () => {
    const props = buildProps({
      getAnimeListItemProps: jest.fn((anime) => ({
        ...buildProps().getAnimeListItemProps(anime),
        folderPath: anime._id === 'anime-1' ? '/storage/anime-1' : null,
      })),
    });
    mockAnimeCard.mockClear();
    const { UNSAFE_getByType } = render(<AnimeListScreenView model={props} />);

    const list = UNSAFE_getByType(FlatList);

    expect(list.props.extraData).toBeUndefined();
    expect(mockAnimeCard.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ anime: props.animes[0], folderPath: '/storage/anime-1' }),
    );
  });

  it('mounts about one screen of rows and keeps a small window of them alive', () => {
    const { UNSAFE_getByType } = render(<AnimeListScreenView model={buildProps()} />);

    const list = UNSAFE_getByType(FlatList);

    expect(list.props.initialNumToRender).toBe(8);
    expect(list.props.windowSize).toBe(5);
    expect(list.props.maxToRenderPerBatch).toBe(4);
  });

  it('shows the sync alert inside the list column when the PC rejected the send', () => {
    const props = buildProps({
      syncStatus: {
        actionLabel: null,
        chipLabel: 'Envío rechazado',
        description: 'La PC respondió, pero rechazó el envío.',
        kind: 'rejected',
        title: 'La PC no aceptó tus cambios',
        tone: 'danger',
      },
    });

    const { getByTestId } = render(<AnimeListScreenView model={props} />);
    const column = within(getByTestId('anime-list-column'));

    expect(column.getByText('La PC no aceptó tus cambios')).toBeTruthy();
    expect(column.getByTestId('heroui-alert')).toBeTruthy();
  });

  it('keeps the alert away while the PC has been unreachable for less than 72 h', () => {
    const props = buildProps({
      syncStatus: {
        actionLabel: 'Revisar conexión',
        chipLabel: 'Esperando a la PC',
        description: 'Tienes 2 cambios guardados en este dispositivo.',
        kind: 'waiting',
        title: 'Esperando a la PC',
        tone: 'default',
      },
    });

    const { queryByTestId } = render(<AnimeListScreenView model={props} />);

    expect(queryByTestId('heroui-alert')).toBeNull();
  });

  it('opens settings from the alert action once the backlog is stale', () => {
    const handleOpenSettings = jest.fn();
    const props = buildProps({
      handleOpenSettings,
      syncStatus: {
        actionLabel: 'Revisar conexión',
        chipLabel: 'Esperando a la PC',
        description: 'Tus cambios siguen guardados en este dispositivo.',
        kind: 'stale',
        title: 'Hace 3 días que no hay sync',
        tone: 'warning',
      },
    });

    const { getByTestId } = render(<AnimeListScreenView model={props} />);

    fireEvent.press(within(getByTestId('anime-list-column')).getByText('Revisar conexión'));

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
    const { getByLabelText } = render(renderHeaderRight({ isManualSyncEnabled: false }));

    expect(getByLabelText('Refrescar Mis Animes').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });

  it('opens the sync sheet from the status button in a fixed-width end column', () => {
    const handleOpenSyncSheet = jest.fn();
    const { getByLabelText, UNSAFE_getAllByType } = render(
      renderHeaderRight({ handleOpenSyncSheet, sideColumnStyle: PHONE_SIDE_COLUMN }),
    );

    fireEvent.press(getByLabelText('Sincronización: Al día'));

    expect(handleOpenSyncSheet).toHaveBeenCalledTimes(1);
    expect(UNSAFE_getAllByType(Button)).toHaveLength(2);
    expect(UNSAFE_getAllByType(View)[0]?.props.style).toEqual({ width: 96 });
  });
});

/** The phone's fixed side column, hoisted so the prop is not a fresh object per render. */
const PHONE_SIDE_COLUMN = { width: 96 };

/** An up-to-date sync status, hoisted so the prop is not a fresh object per render. */
const SYNCED_STATUS: AnimeListScreenRenderModel['syncStatus'] = {
  actionLabel: null,
  chipLabel: 'Al día',
  description: 'Último sync hace un momento.',
  kind: 'synced',
  title: 'Al día',
  tone: 'success',
};

/** Renders the bar's end column with an up-to-date sync status, overriding any prop. */
function renderHeaderRight(
  overrides: Partial<React.ComponentProps<typeof AnimeListScreenHeaderRight>> = {},
) {
  return (
    <AnimeListScreenHeaderRight
      refreshAccessibilityLabel="Refrescar Mis Animes"
      isRefreshing={false}
      isManualSyncEnabled
      sideColumnStyle={PHONE_SIDE_COLUMN}
      syncStatus={SYNCED_STATUS}
      themeColorForeground="#ffffff"
      handleOpenSyncSheet={jest.fn()}
      handleRefreshPress={jest.fn()}
      {...overrides}
    />
  );
}
