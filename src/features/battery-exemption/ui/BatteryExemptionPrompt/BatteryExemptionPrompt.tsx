import { Button, cn, Dialog } from 'heroui-native';
import { View } from 'react-native';
import type { BatteryExemptionPromptContentProps } from './battery-exemption-prompt.types';
import { useBatteryExemptionPrompt } from './use-battery-exemption-prompt';

/** Renders the dismiss and allow actions of the battery-exemption dialog. */
function BatteryExemptionPromptActions(props: Readonly<BatteryExemptionPromptContentProps>) {
  const { copy, onAllow, onDismiss } = props;

  return (
    <View className={cn('flex-row justify-end gap-3')}>
      <Button onPress={onDismiss} variant="ghost">
        <Button.Label>{copy.dismissActionLabel}</Button.Label>
      </Button>
      <Button onPress={onAllow} variant="primary">
        <Button.Label>{copy.allowActionLabel}</Button.Label>
      </Button>
    </View>
  );
}

/** Renders the copy and the two answers of the battery-exemption dialog. */
function BatteryExemptionPromptContent(props: Readonly<BatteryExemptionPromptContentProps>) {
  const { copy, onAllow, onDismiss } = props;

  return (
    <Dialog.Content className={cn('w-full max-w-md self-center')}>
      <Dialog.Close variant="ghost" />
      <View className={cn('mb-5 gap-1.5')}>
        <Dialog.Title>{copy.title}</Dialog.Title>
        <Dialog.Description>{copy.description}</Dialog.Description>
      </View>
      <BatteryExemptionPromptActions copy={copy} onAllow={onAllow} onDismiss={onDismiss} />
    </Dialog.Content>
  );
}

/**
 * Renders the global battery-exemption dialog (first prompt or one-time reminder). Every dismissal
 * route -- the close button, the overlay or a drag -- reports the same answer as the dismiss
 * action, because this dialog renders no trigger and every open-change it emits is the closing one.
 */
export function BatteryExemptionPrompt() {
  const { isOpen, copy, handleAllow, handleDismiss } = useBatteryExemptionPrompt();

  return (
    <Dialog isOpen={isOpen} onOpenChange={handleDismiss}>
      <Dialog.Portal>
        <Dialog.Overlay />
        {copy ? (
          <BatteryExemptionPromptContent
            copy={copy}
            onAllow={handleAllow}
            onDismiss={handleDismiss}
          />
        ) : null}
      </Dialog.Portal>
    </Dialog>
  );
}
