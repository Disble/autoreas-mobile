/* eslint-disable react-doctor/jsx-max-depth -- HeroUI Alert compound shape (Alert > Alert.Content > chip row > Chip > Chip.Label) sets the depth; flattening would leave the Alert API. */
import { Alert, Button, Chip } from 'heroui-native';
import { View } from 'react-native';
import { shouldShowSyncStatusAlert } from './sync-status-control.helpers';
import type { SyncStatusAlertProps } from './sync-status-control.types';

/** Renders the sync alert above the list, only for a rejected send or a stale backlog. */
export function SyncStatusAlert({ status, onAction }: Readonly<SyncStatusAlertProps>) {
  if (!shouldShowSyncStatusAlert(status)) {
    return null;
  }

  return (
    <View className="pb-4">
      <Alert status={status.tone}>
        <Alert.Indicator />
        <Alert.Content>
          <View className="flex-row flex-wrap items-center gap-2">
            <Chip color={status.tone} size="sm" variant="secondary">
              <Chip.Label>{status.chipLabel}</Chip.Label>
            </Chip>
            <Alert.Title>{status.title}</Alert.Title>
          </View>
          <Alert.Description>{status.description}</Alert.Description>
        </Alert.Content>
        {status.actionLabel ? (
          <Button size="sm" variant="secondary" onPress={onAction}>
            <Button.Label>{status.actionLabel}</Button.Label>
          </Button>
        ) : null}
      </Alert>
    </View>
  );
}
