import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { AppText } from '../../components/app-text';
import { ScreenScrollView } from '../../components/screen-scroll-view';
import { useAppTheme } from '../../contexts/app-theme-context';

export default function HomeScreen() {
  const { isDark } = useAppTheme();

  return (
    <ScreenScrollView>
      <View className="flex-1 items-center justify-center py-20">
        <AppText className="text-foreground text-2xl font-bold">
          Autoreas Mobile
        </AppText>
        <AppText className="text-muted text-base text-center mt-4">
          Offline-first anime tracker
        </AppText>
      </View>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ScreenScrollView>
  );
}
