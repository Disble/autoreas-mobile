import { Stack } from 'expo-router';
import { useThemeColor } from 'heroui-native';
import { useCallback } from 'react';
import { Platform, View } from 'react-native';
import { AppText } from '../../components/app-text';
import { ThemeToggle } from '../../components/theme-toggle';
import { useAppTheme } from '../../contexts/app-theme-context';

export default function TabsLayout() {
  const { isDark } = useAppTheme();
  const [themeColorForeground, themeColorBackground] = useThemeColor([
    'foreground',
    'background',
  ]);

  const renderTitle = () => (
    <AppText className="text-foreground font-semibold text-lg">
      Mis Animes
    </AppText>
  );

  const renderThemeToggle = useCallback(() => <ThemeToggle />, []);

  return (
    <View className="flex-1 bg-background">
      <Stack
        screenOptions={{
          headerTitleAlign: 'center',
          headerTransparent: true,
          headerBlurEffect: isDark ? 'dark' : 'light',
          headerTintColor: themeColorForeground,
          headerStyle: {
            backgroundColor: Platform.select({
              ios: undefined,
              android: themeColorBackground,
            }),
          },
          headerTitleStyle: {
            fontFamily: 'Inter_600SemiBold',
          },
          headerRight: renderThemeToggle,
          headerBackButtonDisplayMode: 'generic',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          contentStyle: {
            backgroundColor: themeColorBackground,
          },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            headerTitle: renderTitle,
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            headerTitle: 'Configuración',
          }}
        />
      </Stack>
    </View>
  );
}
