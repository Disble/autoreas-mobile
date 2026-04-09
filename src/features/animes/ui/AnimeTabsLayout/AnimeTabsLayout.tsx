import { Stack } from 'expo-router';
import { View } from 'react-native';
import { ThemeToggle } from '../../../../components/theme-toggle';
import type { AnimeTabsLayoutProps } from './anime-tabs-layout.types';
import { useAnimeTabsLayout } from './use-anime-tabs-layout';

export function AnimeTabsLayout(props: AnimeTabsLayoutProps) {
  const {
    headerBackgroundColor,
    isDark,
    themeColorBackground,
    themeColorForeground,
  } = useAnimeTabsLayout(props);

  return (
    <View className="flex-1 bg-background">
      <Stack
        screenOptions={{
          contentStyle: {
            backgroundColor: themeColorBackground,
          },
          gestureDirection: 'horizontal',
          gestureEnabled: true,
          headerBackButtonDisplayMode: 'generic',
          headerBlurEffect: isDark ? 'dark' : 'light',
          headerRight: () => <ThemeToggle />,
          headerStyle: {
            backgroundColor: headerBackgroundColor,
          },
          headerTintColor: themeColorForeground,
          headerTitleAlign: 'center',
          headerTitleStyle: {
            fontFamily: 'Inter_600SemiBold',
          },
          headerTransparent: true,
        }}
      >
        <Stack.Screen name="index" options={{ headerTitle: 'Mis Animes' }} />
        <Stack.Screen
          name="settings"
          options={{ headerTitle: 'Configuración' }}
        />
      </Stack>
    </View>
  );
}
