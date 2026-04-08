import { render, fireEvent } from '@testing-library/react-native';
import { AnimeCard } from '../../../src/components/anime/AnimeCard';
import type { Anime } from '../../../src/infrastructure/validation/anime-schema';

jest.mock('expo-image', () => ({
  Image: 'Image',
}));

describe('AnimeCard', () => {
  const mockAnime: Anime = {
    _id: '1',
    nombre: 'Test Anime',
    estado: 0,
    nrocapvisto: 5,
    totalcap: 12,
    generos: ['Action', 'Comedy'],
    dias: [{ dia: 'Monday', orden: 1 }],
    activo: 1,
    primeravez: 0,
    fechaUltCapVisto: Date.now(),
    fechaEstreno: null,
    fechaCreacion: Date.now(),
    fechaEliminacion: null,
    portada: 'http://example.com/image.png',
    pagina: null,
    carpeta: null,
    estudios: null,
    origen: null,
    tipo: 1,
    duracion: 24,
  };

  it('renders anime info correctly', () => {
    const onPlus = jest.fn();
    const onMinus = jest.fn();

    const { getByText } = render(
      <AnimeCard anime={mockAnime} onCapPlus={onPlus} onCapMinus={onMinus} />
    );

    expect(getByText('Test Anime')).toBeTruthy();
    expect(getByText('Capítulo: 5 / 12')).toBeTruthy();
    expect(getByText('Action')).toBeTruthy();
    expect(getByText('Monday')).toBeTruthy();
  });

  it('calls onCapPlus and onCapMinus when buttons are pressed', () => {
    const onPlus = jest.fn();
    const onMinus = jest.fn();

    const { getByLabelText } = render(
      <AnimeCard anime={mockAnime} onCapPlus={onPlus} onCapMinus={onMinus} />
    );

    const plusBtn = getByLabelText('Increase chapter');
    const minusBtn = getByLabelText('Decrease chapter');

    fireEvent.press(plusBtn);
    expect(onPlus).toHaveBeenCalledWith(mockAnime);

    fireEvent.press(minusBtn);
    expect(onMinus).toHaveBeenCalledWith(mockAnime);
  });
});