import { Card } from "heroui-native";
import { AnimeCardContent } from "./AnimeCardContent";
import { AnimeCardCover } from "./AnimeCardCover";
import type { AnimeCardProps } from "./anime-card.types";
import { useAnimeCard } from "./use-anime-card";

/** Renders the anime card interface. */
export function AnimeCard(props: Readonly<AnimeCardProps>) {
  const { anime, coverUri } = props;
  const {
    isMutationLocked,
    disableDecrease,
    disableIncrease,
    stateChip,
    seasonStatus,
    restantesShown,
    restantesLabel,
    toggleRestantesShown,
    handleCapMinusPress,
    handleCapPlusPress,
    handleStateBadgePress,
    handleCapPlusLongPress,
    handleCapMinusLongPress,
    handleOpenSeasonRatingSheet,
  } = useAnimeCard(props);

  const chaptersLabel =
    anime.nrocapvisto === 1
      ? "1 capítulo"
      : `${anime.nrocapvisto} capítulos`;
  const defaultMeta = `${chaptersLabel} · ${stateChip.label}`;
  const metaLabel =
    restantesShown && restantesLabel ? restantesLabel : defaultMeta;

  return (
    <Card className="mb-3 overflow-hidden p-0">
      <Card.Body className="flex-row">
        <AnimeCardCover coverUri={coverUri} />
        <AnimeCardContent
          title={anime.nombre}
          metaLabel={metaLabel}
          onToggleMeta={toggleRestantesShown}
          seasonStatus={seasonStatus}
          stateChip={stateChip}
          onStateBadgePress={handleStateBadgePress}
          isMutationLocked={isMutationLocked}
          nrocapvisto={anime.nrocapvisto}
          disableDecrease={disableDecrease}
          disableIncrease={disableIncrease}
          onOpenSeasonRatingSheet={handleOpenSeasonRatingSheet}
          onCapMinusPress={handleCapMinusPress}
          onCapPlusPress={handleCapPlusPress}
          onCapMinusLongPress={handleCapMinusLongPress}
          onCapPlusLongPress={handleCapPlusLongPress}
        />
      </Card.Body>
    </Card>
  );
}
