import { View } from 'react-native';
import { chunkTiles } from './settings-screen.helpers';
import { SettingsMetricTile } from './SettingsMetricTile';
import type { SettingsMetricTileGridProps } from './settings-screen.types';

export function SettingsMetricTileGrid(props: SettingsMetricTileGridProps) {
  const { colors, columns, tiles } = props;
  const rows = chunkTiles(tiles, columns);

  return (
    <View className="gap-3">
      {rows.map((row, rowIndex) => {
        const isFullSpanRow = row.length === 1 && row[0]?.span === 'full';
        const padCount = isFullSpanRow ? 0 : Math.max(columns - row.length, 0);

        return (
          <View className="flex-row gap-3" key={`tile-row-${rowIndex}`}>
            {row.map((tile) => (
              <SettingsMetricTile colors={colors} key={tile.id} tile={tile} />
            ))}
            {padCount > 0
              ? Array.from({ length: padCount }).map((_, padIndex) => (
                  <View
                    className="flex-1"
                    key={`tile-pad-${rowIndex}-${padIndex}`}
                  />
                ))
              : null}
          </View>
        );
      })}
    </View>
  );
}
