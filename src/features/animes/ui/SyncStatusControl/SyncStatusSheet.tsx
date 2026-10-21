/* eslint-disable react-doctor/jsx-max-depth -- HeroUI BottomSheet compound shape (Portal > Content > status row > text column) sets the depth; flattening would leave the BottomSheet API. */
import { BottomSheet, Button } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { SyncStatusGlyph } from './SyncStatusGlyph';
import { SYNC_STATUS_SHEET_TITLE } from './sync-status-control.constants';
import type { SyncStatusSheetProps } from './sync-status-control.types';
import { useSyncStatusSheet } from './use-sync-status-sheet';

/**
 * Renders the "Sincronización" sheet: the state once, a second line only when it adds something,
 * the description, and full-width actions. It closes by overlay tap or swipe; no close button.
 */
export function SyncStatusSheet(props: Readonly<SyncStatusSheetProps>) {
  const { isOpen, status } = props;
  const { actions, handleOpenChange, secondLine } = useSyncStatusSheet(props);

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={handleOpenChange}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content contentContainerClassName="flex-none gap-4 p-5 pb-safe-offset-5">
          <BottomSheet.Title className="text-foreground text-lg font-semibold">
            {SYNC_STATUS_SHEET_TITLE}
          </BottomSheet.Title>

          <View className="bg-surface-secondary flex-row gap-3 rounded-xl p-3">
            <View className="h-5 w-5 items-center justify-center">
              <SyncStatusGlyph status={status} />
            </View>
            <View className="flex-1 gap-1">
              <AppText className="text-foreground text-[15px] font-medium">{status.chipLabel}</AppText>
              {secondLine ? <AppText className="text-reading text-[13px]">{secondLine}</AppText> : null}
              <AppText className="text-muted text-[13px]">{status.description}</AppText>
            </View>
          </View>

          {actions.length > 0 ? (
            <View className="flex-row gap-2">
              {actions.map((action) => (
                <Button
                  key={action.key}
                  className="flex-1"
                  onPress={action.onPress}
                  variant={action.variant}
                >
                  <Button.Label>{action.label}</Button.Label>
                </Button>
              ))}
            </View>
          ) : null}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
