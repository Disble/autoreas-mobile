import { useCallback, useMemo } from 'react';
import { SYNC_STATUS_SYNC_NOW_LABEL } from './sync-status-control.constants';
import { deriveSyncStatusSecondLine } from './sync-status-control.helpers';
import type { SyncStatusSheetAction, SyncStatusSheetProps } from './sync-status-control.types';

/**
 * Builds the sync sheet's second line and actions. The state's own action comes first and is the
 * primary one; "Sincronizar ahora" follows, primary only when it is alone, and is left out while a
 * sync runs or when no manual sync is possible (offline, unpaired).
 */
export function useSyncStatusSheet(props: SyncStatusSheetProps) {
  const { isManualSyncEnabled, status, onAction, onClose, onSyncNow } = props;

  // 5. Derived State
  const secondLine = deriveSyncStatusSecondLine(status);
  const actions = useMemo<readonly SyncStatusSheetAction[]>(() => {
    const list: SyncStatusSheetAction[] = [];
    if (status.actionLabel) {
      list.push({
        key: 'action',
        label: status.actionLabel,
        variant: 'primary',
        onPress: () => {
          onClose();
          onAction();
        },
      });
    }
    if (isManualSyncEnabled && status.kind !== 'syncing') {
      list.push({
        key: 'sync-now',
        label: SYNC_STATUS_SYNC_NOW_LABEL,
        variant: list.length === 0 ? 'primary' : 'secondary',
        onPress: () => {
          onClose();
          void onSyncNow();
        },
      });
    }
    return list;
  }, [isManualSyncEnabled, onAction, onClose, onSyncNow, status.actionLabel, status.kind]);

  // 6. Callbacks
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    [onClose],
  );

  return { actions, handleOpenChange, secondLine };
}
