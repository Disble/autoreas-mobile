import { Chip } from 'heroui-native';
import { Pressable, View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { META_DOT_SEPARATOR, META_TOGGLE_HIT_SLOP, TITLE_COPY_HINT } from './anime-card.constants';
import type { AnimeCardInfoProps, AnimeCardMetaToggleProps } from './anime-card.types';

/**
 * Renders the meta line as one span per segment, all at 13 pt: the hierarchy is color only, the
 * count in the app's `reading` role and the state and the note in `muted`. The round dot is
 * prepended only to a segment that is not first and the helper already dropped the blank ones, so
 * it can never lead, trail or double; the spoken label keeps its own text separator.
 * No span caps its lines or asks for nowrap, so a long count or note wraps inside the text column.
 * The whole composed line is the accessible label of the pressable, so a screen reader hears one
 * string even though the line is drawn as several spans; the toggle keeps its action as a hint.
 * The line is 18 pt tall (`leading-[18px]`) and reaches 44 pt through `META_TOGGLE_HIT_SLOP`, never
 * through a minimum height: a taller box would add drawn space and pull the line away from the title.
 */
function AnimeCardMetaToggle(props: Readonly<AnimeCardMetaToggleProps>) {
  const { segments, label, hint, onPress } = props;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      hitSlop={META_TOGGLE_HIT_SLOP}
      className="mt-1 self-start"
    >
      <AppText className="text-muted text-[13px] leading-[18px]">
        {segments.map((segment, index) =>
          segment.kind === 'count' ? (
            <AppText key={segment.kind} className="text-reading text-[13px] font-normal">
              {index > 0 ? `${META_DOT_SEPARATOR}${segment.text}` : segment.text}
            </AppText>
          ) : (
            <AppText key={segment.kind} className="text-muted text-[13px]">
              {index > 0 ? `${META_DOT_SEPARATOR}${segment.text}` : segment.text}
            </AppText>
          ),
        )}
      </AppText>
    </Pressable>
  );
}

/**
 * Renders the anime card title, the meta line that toggles the remaining form, and the long-episode
 * mark.
 * The title is 16 pt at regular weight (`text-base`, and the `font-normal` AppText prepends) in the
 * `foreground` role, capped at two lines with `leading-tight`. A long press on it copies it; the
 * copy confirms itself with a toast, so the text carries no press styling of its own.
 */
export function AnimeCardInfo(props: Readonly<AnimeCardInfoProps>) {
  const {
    title,
    metaSegments,
    metaLabel,
    metaToggleHint,
    longEpisodeLabel,
    onToggleMeta,
    onTitleLongPress,
  } = props;

  return (
    <View className="flex-1">
      <AppText
        className="text-foreground text-base leading-tight"
        numberOfLines={2}
        accessibilityHint={TITLE_COPY_HINT}
        onLongPress={onTitleLongPress}
      >
        {title}
      </AppText>
      <AnimeCardMetaToggle
        segments={metaSegments}
        label={metaLabel}
        hint={metaToggleHint}
        onPress={onToggleMeta}
      />
      {longEpisodeLabel ? (
        <Chip className="mt-2 self-start" color="warning" size="sm" variant="secondary">
          <Chip.Label>{longEpisodeLabel}</Chip.Label>
        </Chip>
      ) : null}
    </View>
  );
}
