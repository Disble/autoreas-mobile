/* eslint-disable react-doctor/jsx-max-depth -- HeroUI Alert compound shape (Alert > Alert.Content > chip row > Chip > Chip.Label) sets the depth; flattening would leave the Alert API. */
import { Alert as HeroAlert, Button, Chip } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { AnimeFolderBanner } from '../../../anime-folders/ui/AnimeFolderBanner';
import { ANIME_LIST_SCREEN_SYNC_CHIP_COLOR_BY_TONE } from './anime-list-screen.constants';
import type { AnimeListScreenStatusSectionProps } from './anime-list-screen.types';

/** Renders contextual list copy, the visible offline-first sync status, and the anime folder banner. */
export function AnimeListScreenStatusSection(
  props: Readonly<AnimeListScreenStatusSectionProps>,
) {
  const { contextualHeader, isSeasonMode, syncStatus, handleOpenSettings } = props;

  return (
    <View className="mx-auto w-full max-w-5xl px-5 pb-3 pt-2">
      <View className="flex-row items-center gap-2">
        {contextualHeader.isToday && <View className="bg-accent h-2 w-2 rounded-full" />}
        <AppText className="text-muted text-sm">{contextualHeader.subtitle}</AppText>
        {isSeasonMode && (
          <Chip color="accent" size="sm" variant="secondary">
            <Chip.Label>Modo temporada</Chip.Label>
          </Chip>
        )}
      </View>

      <View className="pt-3">
        <HeroAlert status={syncStatus.tone}>
          <HeroAlert.Indicator />
          <HeroAlert.Content>
            <View className="flex-row flex-wrap items-center gap-2">
              <Chip
                color={ANIME_LIST_SCREEN_SYNC_CHIP_COLOR_BY_TONE[syncStatus.tone]}
                size="sm"
                variant="secondary"
              >
                <Chip.Label>{syncStatus.chipLabel}</Chip.Label>
              </Chip>
              <HeroAlert.Title>{syncStatus.title}</HeroAlert.Title>
            </View>
            <HeroAlert.Description>{syncStatus.description}</HeroAlert.Description>
          </HeroAlert.Content>
          {syncStatus.actionLabel ? (
            <Button size="sm" variant="secondary" onPress={handleOpenSettings}>
              <Button.Label>{syncStatus.actionLabel}</Button.Label>
            </Button>
          ) : null}
        </HeroAlert>
      </View>

      <AnimeFolderBanner />
    </View>
  );
}
