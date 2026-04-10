import React from 'react';
import { render } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import { AnimeListScreenView } from '../../../../src/features/animes/ui/AnimeListScreen/AnimeListScreen';
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
    refreshAccessibilityLabel: 'Refrescar Mis Animes',
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
});
