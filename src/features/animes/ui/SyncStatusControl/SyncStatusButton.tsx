import { Button } from 'heroui-native';
import { SyncStatusGlyph } from './SyncStatusGlyph';
import type { SyncStatusButtonProps } from './sync-status-control.types';
import { useSyncStatusGlyph } from './use-sync-status-button';

/** Renders the 44 pt bar button that shows the sync state and opens its sheet. */
export function SyncStatusButton({ status, onPress }: Readonly<SyncStatusButtonProps>) {
  const { accessibilityLabel } = useSyncStatusGlyph({ status });

  return (
    <Button
      accessibilityLabel={accessibilityLabel}
      className="size-11 rounded-full"
      isIconOnly
      onPress={onPress}
      variant="ghost"
    >
      <SyncStatusGlyph status={status} />
    </Button>
  );
}
