import { renderHook, act } from '@testing-library/react-native';
import { useAnimeList } from '../../../src/features/animes/use-anime-list';

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn().mockReturnValue({}),
}));

const mockData = [
  { _id: '1', nombre: 'Anime 1', estado: 0, primeravez: 0, activo: 1 },
  { _id: '2', nombre: 'Anime 2', estado: 0, primeravez: 1, activo: 1 },
];

const mockWhere = jest.fn().mockReturnThis();
const mockOrderBy = jest.fn().mockReturnThis();

const mockQuery = {
  where: mockWhere,
  orderBy: mockOrderBy,
};

jest.mock('../../../src/infrastructure/db/client', () => ({
  createDrizzleDb: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnValue(mockQuery),
  })),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn((query) => ({ data: mockData })),
}));

describe('useAnimeList', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders default tab (viendo)', () => {
    const { result } = renderHook(() => useAnimeList());
    
    expect(result.current.data).toEqual(mockData);
  });

  it('renders estrenos tab', () => {
    const { result } = renderHook(() => useAnimeList('estrenos'));
    
    expect(result.current.data).toEqual(mockData);
  });

  it('renders todos tab', () => {
    const { result } = renderHook(() => useAnimeList('todos'));
    
    expect(result.current.data).toEqual(mockData);
  });
});