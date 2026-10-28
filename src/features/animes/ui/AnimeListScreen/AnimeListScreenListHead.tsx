import { Chip } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { AnimeFolderBanner } from '../../../anime-folders/ui/AnimeFolderBanner';
import { SyncStatusAlert } from '../SyncStatusControl/SyncStatusAlert';
import type { AnimeListScreenListHeadProps } from './anime-list-screen.types';

/**
 * Renders the head of the list column: the sync alert (only for a rejected send or a stale
 * backlog), the contextual subtitle with the season-mode chip, and the anime folder banner.
 * Everyday sync state lives in the bar button, not here.
 */
export function AnimeListScreenListHead(props: Readonly<AnimeListScreenListHeadProps>) {
  const { contextualHeader, isSeasonMode, syncStatus, handleOpenSettings } = props;

  return (
    <View className="pb-4 pt-1">
      <SyncStatusAlert onAction={handleOpenSettings} status={syncStatus} />
      <View className="flex-row flex-wrap items-center gap-2">
        {contextualHeader.isToday && <View className="bg-accent h-1.5 w-1.5 rounded-full" />}
        <AppText
          className={contextualHeader.isToday ? 'text-reading text-sm' : 'text-muted text-sm'}
        >
          {contextualHeader.subtitle}
        </AppText>
        {isSeasonMode && (
          <Chip color="accent" size="sm" variant="secondary">
            <Chip.Label>Modo temporada</Chip.Label>
          </Chip>
        )}
      </View>
      <AnimeFolderBanner />
    </View>
  );
}
