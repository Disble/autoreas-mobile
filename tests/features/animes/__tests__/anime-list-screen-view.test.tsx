import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import { Button } from 'heroui-native';
import { AnimeListScreenView } from '../../../../src/features/animes/ui/AnimeListScreen/AnimeListScreen';
import { AnimeListScreenHeaderRight } from '../../../../src/features/animes/ui/AnimeListScreen/AnimeListScreenHeaderRight';
import type { AnimeListScreenViewProps } from '../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen.types';

type AnimeListItem = AnimeListScreenViewProps['animes'][number];

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

jest.mock('../../../../src/features/animes/ui/AnimeCard', () => ({
  AnimeCard: () => null,
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
  };
}

function buildProps(
  overrides: Partial<AnimeListScreenViewProps> = {},
): AnimeListScreenViewProps {
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
    handleOpenSettings: jest.fn(),
    handleOpenStateSheet: jest.fn(),
    handleRefresh: jest.fn().mockResolvedValue(undefined),
    handleSelectedFilterChange: jest.fn(),
    handleStateSheetSelect: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('AnimeListScreenView', () => {
  it('uses three columns in tablet landscape layout', () => {
    const { UNSAFE_getByType } = render(<AnimeListScreenView {...buildProps()} />);

    const list = UNSAFE_getByType(FlatList);

    expect(list.props.numColumns).toBe(3);
  });

  it('wraps landscape grid items so each card fills its column width', () => {
    const props = buildProps();
    const { UNSAFE_getByType } = render(<AnimeListScreenView {...props} />);

    const list = UNSAFE_getByType(FlatList);
    const row = list.props.renderItem({ item: props.animes[0] });

    expect(row.props.className).toContain('flex-1');
  });

  it('passes mutation state as extraData so visible rows rerender on button lock changes', () => {
    const props = buildProps({
      isMutatingAnimeById: {
        'anime-1': true,
      },
    });
    const { UNSAFE_getByType } = render(<AnimeListScreenView {...props} />);

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

    const { getByText } = render(<AnimeListScreenView {...props} />);

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

    const { getByText } = render(<AnimeListScreenView {...props} />);

    fireEvent.press(getByText('Revisar bridge'));

    expect(handleOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('shows the season-mode indicator only when season mode is on', () => {
    const { queryByText, rerender } = render(
      <AnimeListScreenView {...buildProps({ isSeasonMode: false })} />,
    );

    expect(queryByText('Modo temporada')).toBeNull();

    rerender(<AnimeListScreenView {...buildProps({ isSeasonMode: true })} />);

    expect(queryByText('Modo temporada')).not.toBeNull();
  });

  it('disables pull to refresh from the same manual-sync gate', () => {
    const { UNSAFE_getByType } = render(
      <AnimeListScreenView {...buildProps({ isManualSyncEnabled: false })} />,
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
