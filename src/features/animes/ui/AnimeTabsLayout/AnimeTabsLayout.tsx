import { Stack } from 'expo-router';
import { View } from 'react-native';
import type { AnimeTabsLayoutProps } from './anime-tabs-layout.types';
import { useAnimeTabsLayout } from './use-anime-tabs-layout';

/** Renders the anime tabs layout interface. */
export function AnimeTabsLayout(props: Readonly<AnimeTabsLayoutProps>) {
  const { screenOptions, settingsScreenOptions } = useAnimeTabsLayout(props);

  return (
    <View className="flex-1 bg-background">
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="index" />
        <Stack.Screen name="settings" options={settingsScreenOptions} />
      </Stack>
    </View>
  );
}
