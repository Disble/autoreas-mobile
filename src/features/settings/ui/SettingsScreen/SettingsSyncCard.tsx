/* eslint-disable react-doctor/jsx-max-depth -- structurally unreachable here, not a style waiver:
 * every primitive this file is required to use is a HeroUI Native compound component, and the rule's
 * limit of 2 is below their own minimum nesting. `Chip > Chip.Label` is already 2 levels before any
 * layout wrapper; `Card.Header > View > View > Chip > Chip.Label` and
 * `HeroAlert > HeroAlert.Content > HeroAlert.Title` are the library's documented shapes, not
 * accidental depth. CLAUDE.md mandates HeroUI Native for this UI, so the only ways to satisfy the
 * rule would be to abandon the mandated library or to shatter one card into a component per nesting
 * level, which trades a readability warning for worse readability. The genuinely avoidable depth in
 * this file WAS extracted (see SettingsSyncCardHeader below); what remains is the library's floor.
 */
import { Button, Alert as HeroAlert, Card, Chip, Switch } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import {
  BACKGROUND_SYNC_SECTION_TITLE,
  METRIC_TILE_COLUMNS_BY_LAYOUT,
  STATUS_CHIP_COLOR_BY_TONE,
} from './settings-screen.constants';
import { SettingsMetricTileGrid } from './SettingsMetricTileGrid';
import type { SettingsSyncCardProps } from './settings-screen.types';

/**
 * Renders the card's title row and its status chip. Extracted so the header's own nesting is not
 * counted against the card body's JSX depth: the card already composes a metric grid, a summary
 * row and several alerts, and burying its title four levels down made the whole body harder to
 * scan than the header is worth.
 */
function SettingsSyncCardHeader({
  section,
}: Readonly<Pick<SettingsSyncCardProps, 'section'>>) {
  return (
    <Card.Header className="flex-row items-start gap-3">
      <View className="flex-1 gap-1">
        <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
          <Card.Title>{BACKGROUND_SYNC_SECTION_TITLE}</Card.Title>
          <Chip color={STATUS_CHIP_COLOR_BY_TONE[section.statusTone]} size="sm" variant="secondary">
            <Chip.Label>{section.status}</Chip.Label>
          </Chip>
        </View>
        <Card.Description>
          Snapshot local del runtime para entender si el sync periódico está realmente disponible.
        </Card.Description>
      </View>
    </Card.Header>
  );
}

/** Renders the settings sync card interface. */
export function SettingsSyncCard(props: Readonly<SettingsSyncCardProps>) {
  const {
    colors,
    handleRequestBatteryExemption,
    handleSummaryAction,
    handleToggleSyncTelemetry,
    isBatteryOptimizationExempt,
    isSyncTelemetryEnabled,
    layoutMode,
    section,
    summary,
  } = props;
  const columns = METRIC_TILE_COLUMNS_BY_LAYOUT[layoutMode];

  return (
    <Card className="flex-1" variant="secondary">
      <SettingsSyncCardHeader section={section} />

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

        <View className="h-px w-full bg-surface-secondary" />

        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 gap-1">
            <AppText className="text-sm font-medium text-foreground">
              Excepción de batería
            </AppText>
            <AppText className="text-xs leading-snug text-muted">
              {isBatteryOptimizationExempt
                ? 'La app está exenta de las restricciones de batería de Android.'
                : 'Sin esta excepción, Android puede detener el servicio persistente en segundo plano.'}
            </AppText>
          </View>
          {isBatteryOptimizationExempt ? null : (
            <Button onPress={handleRequestBatteryExemption} size="sm" variant="secondary">
              <Button.Label>Activar excepción</Button.Label>
            </Button>
          )}
        </View>

        <View className="h-px w-full bg-surface-secondary" />

        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 gap-1">
            <AppText className="text-sm font-medium text-foreground">
              Enviar diagnóstico al bridge
            </AppText>
            <AppText className="text-xs leading-snug text-muted">
              Manda el resultado de cada ciclo de sync al bridge para poder diagnosticar fallas
              sin conectar el dispositivo por cable. Sólo viajan códigos y contadores: ningún
              título, ninguna ruta, ningún dato tuyo.
            </AppText>
          </View>
          <Switch
            accessibilityLabel="Enviar diagnóstico de sync al bridge"
            isSelected={isSyncTelemetryEnabled}
            onSelectedChange={handleToggleSyncTelemetry}
          />
        </View>
      </Card.Body>
    </Card>
  );
}
