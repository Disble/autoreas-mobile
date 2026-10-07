import { Button, cn, Dialog } from 'heroui-native';
import { View } from 'react-native';
import type { StartupDatabaseResetDialogProps } from './startup-boundary.types';
import type { StartupResetConfirmation } from '../../recovery/recovery.types';

/** Renders the confirm and cancel actions of the destructive reset dialog. */
function StartupDatabaseResetActions(
  props: Readonly<{
    cancelActionLabel: string;
    confirmActionLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
  }>,
) {
  return (
    <View className={cn('flex-row justify-end gap-3')}>
      <Button onPress={props.onCancel} variant="ghost">
        <Button.Label>{props.cancelActionLabel}</Button.Label>
      </Button>
      <Button onPress={props.onConfirm} variant="danger">
        <Button.Label>{props.confirmActionLabel}</Button.Label>
      </Button>
    </View>
  );
}

/**
 * Renders the dialog body inside the portal.
 *
 * It is a separate component so the confirmation copy and the two actions stay readable without
 * nesting the portal, the content and the buttons into one deeply indented tree.
 */
function StartupDatabaseResetContent(
  props: Readonly<{
    confirmation: StartupResetConfirmation;
    onCancel: () => void;
    onConfirm: () => void;
  }>,
) {
  const { confirmation, onCancel, onConfirm } = props;

  return (
    <Dialog.Content className={cn('w-full max-w-md self-center')}>
      <Dialog.Close variant="ghost" />
      <View className={cn('mb-5 gap-1.5')}>
        <Dialog.Title>{confirmation.title}</Dialog.Title>
        <Dialog.Description>{confirmation.description}</Dialog.Description>
      </View>
      <StartupDatabaseResetActions
        cancelActionLabel={confirmation.cancelActionLabel}
        confirmActionLabel={confirmation.confirmActionLabel}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    </Dialog.Content>
  );
}

/**
 * Renders the single destructive confirmation every database reset must pass through.
 *
 * The dialog copies the confirmation the recovery logic authorized and forwards the user's answer
 * back to it. It holds no state of its own and cannot delete anything: the confirmation text, the
 * action labels and the callbacks all arrive as props, which is what keeps "exactly one explicit
 * confirmation per attempt" a property of the logic instead of a property of this view.
 *
 * Dismissing the dialog by any route -- the close button, the overlay or a drag -- reports the same
 * answer as the cancel action, so an ambiguous gesture can never be mistaken for a confirmation.
 * That is why `onOpenChange` reuses the cancel callback directly: this dialog renders no trigger,
 * so every open-change it emits is the closing one.
 */
export function StartupDatabaseResetDialog(
  props: Readonly<StartupDatabaseResetDialogProps>,
) {
  const { confirmation, isVisible, onCancel, onConfirm } = props;

  return (
    <Dialog isOpen={isVisible} onOpenChange={onCancel}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <StartupDatabaseResetContent
          confirmation={confirmation}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </Dialog.Portal>
    </Dialog>
  );
}
