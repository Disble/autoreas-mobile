import { Chip } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import type { AnimeCardSeasonStatusProps } from './anime-card.types';

/** Renders the anime card season status chip and its description. */
export function AnimeCardSeasonStatus({ status }: Readonly<AnimeCardSeasonStatusProps>) {
  return (
    <View className="mt-2 gap-1">
      <Chip color={status.tone === 'warning' ? 'warning' : 'accent'} size="sm" variant="secondary">
        <Chip.Label>{status.label}</Chip.Label>
      </Chip>
      <AppText className="text-muted text-xs">{status.description}</AppText>
    </View>
  );
}
