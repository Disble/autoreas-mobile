import { Ionicons } from '@expo/vector-icons';
import { cn } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import {
  METRIC_TILE_TONE_BG_CLASS,
  METRIC_TILE_TONE_TEXT_CLASS,
} from './settings-screen.constants';
import { resolveToneIconColor } from './settings-screen.helpers';
import type { SettingsMetricTileProps } from './settings-screen.types';

export function SettingsMetricTile(props: SettingsMetricTileProps) {
  const { colors, tile } = props;
  const iconColor = resolveToneIconColor(tile.tone, colors);

  return (
    <View className="flex-1 gap-1.5 rounded-2xl bg-surface-secondary px-3 py-2.5">
      <View className="flex-row items-center gap-2">
        <View
          className={cn(
            'h-5 w-5 items-center justify-center rounded-full',
            METRIC_TILE_TONE_BG_CLASS[tile.tone],
          )}
        >
          <Ionicons color={iconColor} name={tile.iconName} size={12} />
        </View>
        <AppText
          className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-muted"
          numberOfLines={1}
        >
          {tile.label}
        </AppText>
      </View>
      <AppText
        className={cn(
          'text-[13px] font-semibold leading-tight',
          METRIC_TILE_TONE_TEXT_CLASS[tile.tone],
        )}
        numberOfLines={2}
      >
        {tile.value}
      </AppText>
    </View>
  );
}
