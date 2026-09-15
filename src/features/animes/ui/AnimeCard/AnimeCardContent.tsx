import { View } from 'react-native';
import { AnimeCardActions } from './AnimeCardActions';
import { AnimeCardInfo } from './AnimeCardInfo';
import { AnimeCardStateBadge } from './AnimeCardStateBadge';
import type { AnimeCardContentProps } from './anime-card.types';

/** Renders the anime card right column: title/meta/season info, the state badge, and the actions row. */
export function AnimeCardContent(props: Readonly<AnimeCardContentProps>) {
  const {
    title,
    metaLabel,
    onToggleMeta,
    seasonStatus,
    stateChip,
    onStateBadgePress,
    isMutationLocked,
    nrocapvisto,
    disableDecrease,
    disableIncrease,
    onOpenSeasonRatingSheet,
    onCapMinusPress,
    onCapPlusPress,
    onCapMinusLongPress,
    onCapPlusLongPress,
  } = props;

  return (
    <View className="flex-1 p-3">
      <View className="flex-row items-start gap-2">
        <AnimeCardInfo
          title={title}
          metaLabel={metaLabel}
          onToggleMeta={onToggleMeta}
          seasonStatus={seasonStatus}
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
        onReanudarPress={onStateBadgePress}
        onCapMinusPress={onCapMinusPress}
        onCapPlusPress={onCapPlusPress}
        onCapMinusLongPress={onCapMinusLongPress}
        onCapPlusLongPress={onCapPlusLongPress}
      />
    </View>
  );
}
