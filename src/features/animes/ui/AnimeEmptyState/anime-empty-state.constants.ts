import type { AnimeTab } from '../../anime.types';

export const ICONS: Record<AnimeTab, string> = {
  viendo: 'play-circle-outline',
  estrenos: 'sparkles-outline',
  todos: 'film-outline',
};

export const MESSAGES: Record<AnimeTab, string> = {
  viendo: 'No tenés animes en progreso.',
  estrenos: 'No hay estrenos disponibles.',
  todos: 'No hay animes cargados todavía.',
};

export const HINTS: Record<AnimeTab, string> = {
  viendo: 'Los animes que estés viendo aparecerán acá.',
  estrenos: 'Los estrenos se sincronizan desde el Bridge.',
  todos: 'Conectá el Bridge para sincronizar tu lista.',
};
