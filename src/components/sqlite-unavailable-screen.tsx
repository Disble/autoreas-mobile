import { Ionicons } from '@expo/vector-icons';
import { Alert, Surface } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from './app-text';
import { useSQLiteUnavailableMessage } from '../features/setup/use-sqlite-unavailable-message';

/** Renders the amber warning badge shown above the SQLite unavailable message. */
function WarningIconBadge() {
  return (
    <Surface variant="secondary" className="rounded-full p-5 mb-6">
      <Ionicons name="warning-outline" size={36} color="#f59e0b" />
    </Surface>
  );
}

/** Renders the warning alert that carries the SQLite unavailability message. */
function UnavailableMessageAlert({ message }: { readonly message: string }) {
  return (
    <Alert status="warning" className="w-full mt-2">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

/** Renders the sqlite unavailable screen interface. */
export function SQLiteUnavailableScreen() {
  const { message } = useSQLiteUnavailableMessage();

  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <WarningIconBadge />

      <AppText className="text-foreground text-xl font-bold mb-2 text-center">
        SQLite no disponible
      </AppText>

      <UnavailableMessageAlert message={message} />

      <AppText className="mt-4 text-center text-sm text-muted max-w-[280px]">
        Si usas Expo Go o un dev client antiguo, regéneralo antes de volver
        a abrir la app.
      </AppText>
    </View>
  );
}
