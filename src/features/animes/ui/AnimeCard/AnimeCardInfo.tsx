/* eslint-disable react-doctor/jsx-max-depth -- the meta line is nested Text spans (one per segment) inside an Animated.View for its bump; the spans must stay inline to wrap as one line. */
import { Chip } from 'heroui-native';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AppText } from '../../../../components/app-text';
import { META_DOT_SEPARATOR, META_TOGGLE_HIT_SLOP } from './anime-card.constants';
import type { AnimeCardInfoProps, AnimeCardMetaToggleProps } from './anime-card.types';

/**
 * Renders the meta line as one span per segment, all at 13 pt: the hierarchy is color only, the
 * count in the app's `reading` role and the state and the note in `muted`. After a chapter change
 * the line lifts 1 pt and the count turns accent for a moment (`lineStyle`, `countStyle`). The round
 * dot is prepended only to a segment that is not first and the helper already dropped the blank
 * ones, so it can never lead, trail or double; the spoken label keeps its own text separator.
 * No span caps its lines or asks for nowrap, so a long count or note wraps inside the text column.
 * The whole composed line is the accessible label of the pressable, so a screen reader hears one
 * string even though the line is drawn as several spans; the toggle keeps its action as a hint.
 * The line is 18 pt tall (`leading-[18px]`) and reaches 44 pt through `META_TOGGLE_HIT_SLOP`, never
 * through a minimum height: a taller box would add drawn space and pull the line away from the title.
 */
function AnimeCardMetaToggle(props: Readonly<AnimeCardMetaToggleProps>) {
  const { segments, label, onPress, lineStyle, countStyle } = props;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Alternar episodios restantes"
      onPress={onPress}
      hitSlop={META_TOGGLE_HIT_SLOP}
      className="mt-1 self-start"
    >
      <Animated.View style={lineStyle}>
        <AppText className="text-muted text-[13px] leading-[18px]">
          {segments.map((segment, index) =>
            segment.kind === 'count' ? (
              <Animated.Text
                key={segment.kind}
                className="text-reading text-[13px] font-normal"
                style={countStyle}
              >
                {index > 0 ? `${META_DOT_SEPARATOR}${segment.text}` : segment.text}
              </Animated.Text>
            ) : (
              <AppText key={segment.kind} className="text-muted text-[13px]">
                {index > 0 ? `${META_DOT_SEPARATOR}${segment.text}` : segment.text}
              </AppText>
            ),
          )}
        </AppText>
      </Animated.View>
    </Pressable>
  );
}

/**
 * Renders the anime card title, the meta line that toggles the remaining form, and the long-episode
 * mark.
 * The title is 16 pt at regular weight (`text-base`, and the `font-normal` AppText prepends) in the
 * `foreground` role, capped at two lines with `leading-tight`.
 */
export function AnimeCardInfo(props: Readonly<AnimeCardInfoProps>) {
  const { title, metaSegments, metaLabel, longEpisodeLabel, onToggleMeta, lineStyle, countStyle } =
    props;

  return (
    <View className="flex-1">
      <AppText className="text-foreground text-base leading-tight" numberOfLines={2}>
        {title}
      </AppText>
      <AnimeCardMetaToggle
        segments={metaSegments}
        label={metaLabel}
        onPress={onToggleMeta}
        lineStyle={lineStyle}
        countStyle={countStyle}
      />
      {longEpisodeLabel ? (
        <Chip className="mt-2 self-start" color="warning" size="sm" variant="secondary">
          <Chip.Label>{longEpisodeLabel}</Chip.Label>
        </Chip>
      ) : null}
    </View>
  );
}
