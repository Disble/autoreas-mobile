import { Card } from "heroui-native";
import { AnimeCardContent } from "./AnimeCardContent";
import { AnimeCardCover } from "./AnimeCardCover";
import { getAnimeCardMetaLabel, getAnimeCardMetaSegments, getNoteSegmentLabel } from "./anime-card.helpers";
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
    longEpisodeLabel,
    restantesShown,
    restantesLabel,
    toggleRestantesShown,
    handleCapMinusPress,
    handleCapPlusPress,
    handleStateBadgePress,
    handleCapPlusLongPress,
    handleCapMinusLongPress,
    handleOpenSeasonRatingSheet,
    hasPageLink,
    hasFolder,
    handleOpenPage,
    handleOpenFolder,
  } = useAnimeCard(props);

  const metaParams = {
    nrocapvisto: anime.nrocapvisto,
    stateLabel: stateChip.label,
    noteLabel: getNoteSegmentLabel(seasonStatus),
    restantesLabel,
    restantesShown,
  };
  const metaSegments = getAnimeCardMetaSegments(metaParams);
  const metaLabel = getAnimeCardMetaLabel(metaParams);

  return (
    <Card className="mb-3 overflow-hidden p-0">
      <Card.Body className="flex-row">
        <AnimeCardCover coverUri={coverUri} />
        <AnimeCardContent
          title={anime.nombre}
          metaSegments={metaSegments}
          metaLabel={metaLabel}
          onToggleMeta={toggleRestantesShown}
          seasonStatus={seasonStatus}
          longEpisodeLabel={longEpisodeLabel}
          stateChip={stateChip}
          onStateBadgePress={handleStateBadgePress}
          isMutationLocked={isMutationLocked}
          nrocapvisto={anime.nrocapvisto}
          disableDecrease={disableDecrease}
          disableIncrease={disableIncrease}
          onOpenSeasonRatingSheet={handleOpenSeasonRatingSheet}
          hasPageLink={hasPageLink}
          hasFolder={hasFolder}
          onOpenPage={handleOpenPage}
          onOpenFolder={handleOpenFolder}
          onCapMinusPress={handleCapMinusPress}
          onCapPlusPress={handleCapPlusPress}
          onCapMinusLongPress={handleCapMinusLongPress}
          onCapPlusLongPress={handleCapPlusLongPress}
        />
      </Card.Body>
    </Card>
  );
}
