import { AnimeCard } from '../AnimeCard/AnimeCard';
import type { AnimeListScreenItemProps } from './anime-list-screen.types';
import { useAnimeListScreenItem } from './use-anime-list-screen-item';

/** Renders one list row's AnimeCard from the row's own data and the screen's id-taking handlers. */
export function AnimeListScreenItem(props: Readonly<AnimeListScreenItemProps>) {
  const cardProps = useAnimeListScreenItem(props);

  return <AnimeCard {...cardProps} />;
}
