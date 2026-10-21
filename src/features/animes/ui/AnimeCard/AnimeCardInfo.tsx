import { Chip } from 'heroui-native';
import { Pressable, View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { META_DOT_SEPARATOR } from './anime-card.constants';
import type { AnimeCardInfoProps, AnimeCardMetaToggleProps } from './anime-card.types';

/**
 * Renders the meta line as one span per segment, so each part carries its own size and role: the
 * count at 13 pt in the app's `reading` role, the state and the note at 11 pt in `muted`. The round
 * dot is prepended only to a segment that is not first and the helper already dropped the blank
 * ones, so it can never lead, trail or double; the spoken label keeps its own text separator.
 * No span caps its lines or asks for nowrap, so a long count or note wraps inside the text column.
 * The whole composed line is the accessible label of the pressable, so a screen reader hears one
 * string even though the line is drawn as several spans; the toggle keeps its action as a hint.
 * min-h-11/min-w-11 keep the tap target at 44 pt without enlarging the text: the Pressable box
 * grows, the visible line does not.
 */
function AnimeCardMetaToggle(props: Readonly<AnimeCardMetaToggleProps>) {
  const { segments, label, onPress } = props;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Alternar episodios restantes"
      onPress={onPress}
      className="mt-1 min-h-11 min-w-11 justify-center self-start"
    >
      <AppText className="text-muted">
        {segments.map((segment, index) => (
          <AppText
            key={segment.kind}
            className={
              segment.kind === 'count' ? 'text-reading text-[13px]' : 'text-muted text-[11px]'
            }
          >
            {index > 0 ? `${META_DOT_SEPARATOR}${segment.text}` : segment.text}
          </AppText>
        ))}
      </AppText>
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
  const { title, metaSegments, metaLabel, longEpisodeLabel, onToggleMeta } = props;

  return (
    <View className="flex-1">
      <AppText className="text-foreground text-base leading-tight" numberOfLines={2}>
        {title}
      </AppText>
      <AnimeCardMetaToggle
        segments={metaSegments}
        label={metaLabel}
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
