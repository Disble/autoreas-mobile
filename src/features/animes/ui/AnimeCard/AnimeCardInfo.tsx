import { Chip } from 'heroui-native';
import { Pressable, View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import type { AnimeCardInfoProps } from './anime-card.types';

/**
 * Renders the anime card title, the single meta line that toggles the remaining form, and the
 * long-episode mark.
 * The meta line has no line cap and no nowrap, so a long count or note wraps inside the text
 * column instead of clipping a segment out of sight.
 * The note appears only on that line: the season status row that used to be drawn under it is no
 * longer mounted, because it repeated the note and its description carried bridge wording.
 */
export function AnimeCardInfo(props: Readonly<AnimeCardInfoProps>) {
  const { title, metaLabel, longEpisodeLabel, onToggleMeta } = props;

  return (
    <View className="flex-1">
      <AppText
        className="text-foreground text-sm font-semibold leading-tight"
        numberOfLines={2}
      >
        {title}
      </AppText>
      {/*
       * min-h-11/min-w-11 keep the tap target at 44 pt without enlarging the text:
       * the Pressable box grows, the visible line does not.
       */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Alternar episodios restantes"
        onPress={onToggleMeta}
        className="mt-1 min-h-11 min-w-11 justify-center self-start"
      >
        <AppText className="text-muted text-xs">{metaLabel}</AppText>
      </Pressable>
      {longEpisodeLabel ? (
        <Chip className="mt-2 self-start" color="warning" size="sm" variant="secondary">
          <Chip.Label>{longEpisodeLabel}</Chip.Label>
        </Chip>
      ) : null}
    </View>
  );
}
