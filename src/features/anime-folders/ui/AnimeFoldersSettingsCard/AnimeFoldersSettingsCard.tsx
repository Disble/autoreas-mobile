import { Button, Card } from 'heroui-native';
import { Pressable, View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { StyledIonicons } from '../../../../components/theme-toggle.constants';
import { ANIME_FOLDERS_SETTINGS_COPY } from './anime-folders-settings-card.constants';
import type { AnimeFoldersSettingsCardContentProps } from './anime-folders-settings-card.types';
import { useAnimeFoldersSettingsCard } from './use-anime-folders-settings-card';

/** Renders one labelled value of the card. */
function AnimeFoldersSettingsRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View className="flex-row items-center gap-3">
      <AppText className="w-32 text-[13px] text-muted">{label}</AppText>
      <AppText className="flex-1 text-[13px] font-semibold text-foreground">{value}</AppText>
    </View>
  );
}

/** Renders the card content from its view; dumb so it can be rendered in any state. */
export function AnimeFoldersSettingsCardContent(
  props: Readonly<AnimeFoldersSettingsCardContentProps>,
) {
  const { view, onOpenDetail, onReindex, onChooseRoot } = props;

  return (
    <Card testID="anime-folders-settings-card">
      <Card.Header>
        <AppText className="text-xs font-semibold uppercase tracking-wider text-muted">
          {ANIME_FOLDERS_SETTINGS_COPY.title}
        </AppText>
      </Card.Header>
      <Card.Body className="gap-3 pt-3">
        <AnimeFoldersSettingsRow label={ANIME_FOLDERS_SETTINGS_COPY.rootRowLabel} value={view.rootLabel} />
        {view.hasRoot ? (
          <>
            <AnimeFoldersSettingsRow
              label={ANIME_FOLDERS_SETTINGS_COPY.foundRowLabel}
              value={view.foundLabel}
            />
            <AnimeFoldersSettingsRow
              label={ANIME_FOLDERS_SETTINGS_COPY.reviewedRowLabel}
              value={view.reviewedLabel}
            />
          </>
        ) : null}
        {view.unmatchedLabel ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenDetail}
            className="bg-surface-secondary flex-row items-center gap-3 rounded-xl px-3 py-2.5"
          >
            <AppText className="flex-1 text-sm text-foreground">{view.unmatchedLabel}</AppText>
            <AppText className="text-[13px] text-muted">{ANIME_FOLDERS_SETTINGS_COPY.openDetail}</AppText>
            <StyledIonicons name="chevron-forward" size={16} className="text-muted" />
          </Pressable>
        ) : null}
        <View className="flex-row justify-end gap-2">
          {view.hasRoot ? (
            <>
              <Button size="sm" variant="secondary" onPress={onReindex}>
                <Button.Label>{ANIME_FOLDERS_SETTINGS_COPY.reindex}</Button.Label>
              </Button>
              <Button size="sm" variant="secondary" onPress={onChooseRoot}>
                <Button.Label>{ANIME_FOLDERS_SETTINGS_COPY.changeRoot}</Button.Label>
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onPress={onChooseRoot}>
              <Button.Label>{ANIME_FOLDERS_SETTINGS_COPY.chooseRoot}</Button.Label>
            </Button>
          )}
        </View>
      </Card.Body>
    </Card>
  );
}

/** Renders the "Carpetas de anime" Settings card (canvas 05). */
export function AnimeFoldersSettingsCard() {
  const { view, handleOpenDetail, handleReindex, handleChooseRoot } = useAnimeFoldersSettingsCard();

  if (!view) {
    return null;
  }

  return (
    <AnimeFoldersSettingsCardContent
      view={view}
      onOpenDetail={handleOpenDetail}
      onReindex={handleReindex}
      onChooseRoot={handleChooseRoot}
    />
  );
}
