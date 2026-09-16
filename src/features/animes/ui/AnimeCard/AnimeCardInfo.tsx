import { Pressable, View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { AnimeCardSeasonStatus } from './AnimeCardSeasonStatus';
import type { AnimeCardInfoProps } from './anime-card.types';

/** Renders the anime card title, progress meta toggle, and season status. */
export function AnimeCardInfo(props: Readonly<AnimeCardInfoProps>) {
  const { title, metaLabel, seasonStatus, onToggleMeta } = props;

  return (
    <View className="flex-1">
      <AppText
        className="text-foreground text-sm font-semibold leading-tight"
        numberOfLines={2}
      >
        {title}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Alternar episodios restantes"
        onPress={onToggleMeta}
        hitSlop={8}
        className="mt-1 self-start"
      >
        <AppText className="text-muted text-xs">{metaLabel}</AppText>
      </Pressable>
      {seasonStatus ? <AnimeCardSeasonStatus status={seasonStatus} /> : null}
    </View>
  );
}
