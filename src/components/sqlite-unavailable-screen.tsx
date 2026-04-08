import { Text, View } from 'react-native';
import { EXPO_SQLITE_UNAVAILABLE_MESSAGE } from '../infrastructure/db/native-runtime';

export function SQLiteUnavailableScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-black px-6">
      <Text className="text-center text-2xl font-bold text-white">
        SQLite nativo no disponible
      </Text>
      <Text className="mt-3 text-center text-base text-gray-400">
        {EXPO_SQLITE_UNAVAILABLE_MESSAGE}
      </Text>
      <Text className="mt-4 text-center text-sm text-gray-500">
        Si estas usando Expo Go o un dev client viejo, regeneralo antes de volver a abrir la app.
      </Text>
    </View>
  );
}
