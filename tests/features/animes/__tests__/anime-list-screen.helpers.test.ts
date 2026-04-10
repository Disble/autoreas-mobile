import type { Anime } from '../../../../src/infrastructure/validation/anime-schema';
import {
  buildContextualHeader,
  computeFilterCounts,
} from '../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen.helpers';

function buildAnime(
  id: string,
  dias: Anime['dias'],
  overrides: Partial<Anime> = {},
): Anime {
  return {
    _id: id,
    nombre: id,
    estado: 0,
    nrocapvisto: 0,
    totalcap: null,
    dias,
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
    ...overrides,
  };
}

describe('anime-list-screen helpers', () => {
  describe('computeFilterCounts', () => {
    it('counts animes across all day filters from their dias tags', () => {
      const animes: Anime[] = [
        buildAnime('a', [
          { dia: 'Lunes', orden: 0 },
          { dia: 'Jueves', orden: 0 },
        ]),
        buildAnime('b', [{ dia: 'Jueves', orden: 1 }]),
        buildAnime('c', [{ dia: 'Visto', orden: 0 }]),
      ];

      const counts = computeFilterCounts(animes);

      expect(counts.Lunes).toBe(1);
      expect(counts.Jueves).toBe(2);
      expect(counts.Visto).toBe(1);
      expect(counts.Martes).toBe(0);
    });

    it('returns zero counts when there are no animes', () => {
      const counts = computeFilterCounts([]);

      expect(counts.Lunes).toBe(0);
      expect(counts.Visto).toBe(0);
      expect(counts['Sin ver']).toBe(0);
    });
  });

  describe('buildContextualHeader', () => {
    it('returns a weekday-specific title for a weekday filter', () => {
      const header = buildContextualHeader('Jueves', 3, new Date('2026-04-09T10:00:00.000Z'));

      expect(header.title).toBe('Jueves');
      expect(header.subtitle).toBe('3 animes para ver');
    });

    it('marks the current weekday as "hoy"', () => {
      const header = buildContextualHeader('Jueves', 3, new Date('2026-04-09T10:00:00.000Z'));

      expect(header.isToday).toBe(true);
    });

    it('uses singular copy when there is exactly one anime', () => {
      const header = buildContextualHeader('Viernes', 1, new Date('2026-04-09T10:00:00.000Z'));

      expect(header.subtitle).toBe('1 anime para ver');
    });

    it('uses empty-state copy when there are zero animes', () => {
      const header = buildContextualHeader('Sábado', 0, new Date('2026-04-09T10:00:00.000Z'));

      expect(header.subtitle).toBe('Sin animes para este filtro');
    });

    it('uses pseudo-day copy for Ver hoy', () => {
      const header = buildContextualHeader('Ver hoy', 2, new Date('2026-04-09T10:00:00.000Z'));

      expect(header.title).toBe('Para ver hoy');
      expect(header.subtitle).toBe('2 animes para ver');
    });

    it('uses pseudo-day copy for Visto', () => {
      const header = buildContextualHeader('Visto', 5, new Date('2026-04-09T10:00:00.000Z'));

      expect(header.title).toBe('Vistos');
    });

    it('uses pseudo-day copy for Sin ver', () => {
      const header = buildContextualHeader('Sin ver', 4, new Date('2026-04-09T10:00:00.000Z'));

      expect(header.title).toBe('Sin ver');
    });
  });
});
