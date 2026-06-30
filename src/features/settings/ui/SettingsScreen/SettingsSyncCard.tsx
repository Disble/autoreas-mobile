import { Button, Alert as HeroAlert, Card, Chip } from 'heroui-native';
import { View } from 'react-native';
import {
  BACKGROUND_SYNC_SECTION_TITLE,
  METRIC_TILE_COLUMNS_BY_LAYOUT,
  STATUS_CHIP_COLOR_BY_TONE,
} from './settings-screen.constants';
import { SettingsMetricTileGrid } from './SettingsMetricTileGrid';
import type { SettingsSyncCardProps } from './settings-screen.types';

export function SettingsSyncCard(props: SettingsSyncCardProps) {
  const { colors, handleSummaryAction, layoutMode, section, summary } = props;
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
        <View className="gap-2">
          <View className="flex-row flex-wrap items-center gap-2">
            <Chip color={STATUS_CHIP_COLOR_BY_TONE[summary.tone]} size="sm" variant="secondary">
              <Chip.Label>{summary.chipLabel}</Chip.Label>
            </Chip>
            {summary.actionLabel && handleSummaryAction ? (
              <Button onPress={handleSummaryAction} size="sm" variant="secondary">
                <Button.Label>{summary.actionLabel}</Button.Label>
              </Button>
            ) : null}
          </View>

          <HeroAlert status={summary.tone}>
            <HeroAlert.Indicator />
            <HeroAlert.Content>
              <HeroAlert.Title>{summary.title}</HeroAlert.Title>
              <HeroAlert.Description>{summary.description}</HeroAlert.Description>
            </HeroAlert.Content>
          </HeroAlert>
        </View>

        <View className="h-px w-full bg-surface-secondary" />

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
