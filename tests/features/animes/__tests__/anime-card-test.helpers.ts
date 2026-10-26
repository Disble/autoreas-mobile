import type { AnimeCardProps } from '../../../../src/features/animes/ui/AnimeCard/anime-card.types';

/**
 * Builds a baseline AnimeCard anime payload for UI behavior tests.
 * Keeping the fixture in one helper avoids duplicating season and legacy anime fields across cases.
 */
export function buildAnimeCardAnime(): AnimeCardProps['anime'] {
  return {
    _id: 'anime-1',
    nombre: 'Dandadan',
    estado: 0,
    nrocapvisto: 4,
    totalcap: 12,
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

/**
 * Builds full AnimeCard props for render tests.
 * The helper exposes override seams so each test can focus on the specific season state under review.
 */
export function buildAnimeCardProps(
  overrides: Partial<AnimeCardProps> = {},
): AnimeCardProps {
  return {
    anime: buildAnimeCardAnime(),
    onCapMinus: jest.fn(),
    onCapPlus: jest.fn(),
    onCapMinusHalf: jest.fn(),
    onCapPlusHalf: jest.fn(),
    onOpenStateSheet: jest.fn(),
    onOpenSeasonRatingSheet: jest.fn(),
    ...overrides,
  };
}

/** The slice of a rendered test node these layout checks read. */
export interface RenderedNode {
  readonly type: unknown;
  readonly props: { readonly className?: unknown };
  readonly parent: RenderedNode | null;
}

/** Walks up from a rendered node to the nearest one whose classes include the given class. */
export function findAncestor(node: RenderedNode, className: string): RenderedNode | null {
  let current: RenderedNode | null = node;
  while (current) {
    if (classesOf(current).includes(className)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/** Splits a rendered node's class string into its class names. */
export function classesOf(node: Pick<RenderedNode, 'props'>): string[] {
  return String(node.props.className ?? '').split(' ');
}
