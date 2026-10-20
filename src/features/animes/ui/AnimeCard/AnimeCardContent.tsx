import { View } from 'react-native';
import { AnimeCardActions } from './AnimeCardActions';
import { AnimeCardInfo } from './AnimeCardInfo';
import { AnimeCardStateBadge } from './AnimeCardStateBadge';
import type { AnimeCardContentProps } from './anime-card.types';

/** Renders the anime card right column: title/meta info, the state badge, and the actions row. */
export function AnimeCardContent(props: Readonly<AnimeCardContentProps>) {
  const {
    title,
    metaSegments,
    metaLabel,
    onToggleMeta,
    seasonStatus,
    longEpisodeLabel,
    stateChip,
    onStateBadgePress,
    isMutationLocked,
    nrocapvisto,
    disableDecrease,
    disableIncrease,
    onOpenSeasonRatingSheet,
    hasPageLink,
    hasFolder,
    onOpenPage,
    onOpenFolder,
    onCapMinusPress,
    onCapPlusPress,
    onCapMinusLongPress,
    onCapPlusLongPress,
  } = props;

  return (
    <View className="flex-1 gap-3 p-4">
      <View className="flex-row items-start gap-2">
        <AnimeCardInfo
          title={title}
          metaSegments={metaSegments}
          metaLabel={metaLabel}
          onToggleMeta={onToggleMeta}
          longEpisodeLabel={longEpisodeLabel}
        />
        <AnimeCardStateBadge stateChip={stateChip} onPress={onStateBadgePress} />
      </View>
      <AnimeCardActions
        seasonStatus={seasonStatus}
        isMutationLocked={isMutationLocked}
        nrocapvisto={nrocapvisto}
        disableDecrease={disableDecrease}
        disableIncrease={disableIncrease}
        onOpenSeasonRatingSheet={onOpenSeasonRatingSheet}
        hasPageLink={hasPageLink}
        hasFolder={hasFolder}
        onOpenPage={onOpenPage}
        onOpenFolder={onOpenFolder}
        onReanudarPress={onStateBadgePress}
        onCapMinusPress={onCapMinusPress}
        onCapPlusPress={onCapPlusPress}
        onCapMinusLongPress={onCapMinusLongPress}
        onCapPlusLongPress={onCapPlusLongPress}
      />
    </View>
  );
}
