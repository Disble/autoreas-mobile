import { Alert } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from './app-text';
import { EXPO_SQLITE_UNAVAILABLE_MESSAGE } from '../infrastructure/db/native-runtime';

export function SQLiteUnavailableScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <Alert status="warning" className="w-full">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>SQLite nativo no disponible</Alert.Title>
          <Alert.Description>{EXPO_SQLITE_UNAVAILABLE_MESSAGE}</Alert.Description>
        </Alert.Content>
      </Alert>
      <AppText className="mt-4 text-center text-sm text-muted">
        Si estas usando Expo Go o un dev client viejo, regeneralo antes de volver
        a abrir la app.
      </AppText>
    </View>
  );
}
