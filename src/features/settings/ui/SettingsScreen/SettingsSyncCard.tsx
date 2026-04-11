import { Alert as HeroAlert, Card, Chip } from 'heroui-native';
import { View } from 'react-native';
import {
  BACKGROUND_SYNC_SECTION_TITLE,
  METRIC_TILE_COLUMNS_BY_LAYOUT,
  STATUS_CHIP_COLOR_BY_TONE,
} from './settings-screen.constants';
import { SettingsMetricTileGrid } from './SettingsMetricTileGrid';
import type { SettingsSyncCardProps } from './settings-screen.types';

export function SettingsSyncCard(props: SettingsSyncCardProps) {
  const { colors, layoutMode, section } = props;
  const columns = METRIC_TILE_COLUMNS_BY_LAYOUT[layoutMode];

  return (
    <Card className="flex-1" variant="secondary">
      <Card.Header className="flex-row items-start gap-3">
        <View className="flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <Card.Title>{BACKGROUND_SYNC_SECTION_TITLE}</Card.Title>
            <Chip
              color={STATUS_CHIP_COLOR_BY_TONE[section.statusTone]}
              size="sm"
              variant="secondary"
            >
              <Chip.Label>{section.status}</Chip.Label>
            </Chip>
          </View>
          <Card.Description>
            Snapshot local del runtime para entender si el sync periódico está realmente disponible.
          </Card.Description>
        </View>
      </Card.Header>

      <Card.Body className="flex-1 gap-3 pt-4">
        <HeroAlert status={section.statusTone}>
          <HeroAlert.Indicator />
          <HeroAlert.Content>
            <HeroAlert.Title>{section.title}</HeroAlert.Title>
            <HeroAlert.Description>{section.description}</HeroAlert.Description>
          </HeroAlert.Content>
        </HeroAlert>

        <SettingsMetricTileGrid
          colors={colors}
          columns={columns}
          tiles={section.tiles}
        />
      </Card.Body>
    </Card>
  );
}
