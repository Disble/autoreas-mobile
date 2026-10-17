import { Chip } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import type { AnimeCardSeasonStatusProps } from './anime-card.types';

/** Renders the anime card season status chip with its description beside it, in one row. */
export function AnimeCardSeasonStatus({ status }: Readonly<AnimeCardSeasonStatusProps>) {
  return (
    <View className="mt-2 flex-row items-center gap-2">
      <Chip color={status.tone === 'warning' ? 'warning' : 'accent'} size="sm" variant="secondary">
        <Chip.Label>{status.label}</Chip.Label>
      </Chip>
      <AppText className="text-muted flex-1 text-xs">{status.description}</AppText>
    </View>
  );
}
