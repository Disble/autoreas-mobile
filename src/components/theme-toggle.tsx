import * as Haptics from 'expo-haptics';
import { Button } from 'heroui-native';
import { Platform } from 'react-native';
import Animated, { FadeOut, ZoomIn } from 'react-native-reanimated';
import { useAppTheme } from '../contexts/app-theme-context';
import { StyledAntDesign, StyledIonicons } from './theme-toggle.constants';

/** Renders the application theme toggle control. */
export function ThemeToggle() {
  const { toggleTheme, isLight } = useAppTheme();

  return (
    <Button
      variant="tertiary"
      size="sm"
      isIconOnly
      accessibilityLabel={isLight ? 'Activar modo oscuro' : 'Activar modo claro'}
      onPressIn={() => {
        if (Platform.OS === 'ios') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        }
      }}
      onPress={toggleTheme}
    >
      {isLight ? (
        <Animated.View key="moon" entering={ZoomIn} exiting={FadeOut}>
          <StyledAntDesign name="moon" size={18} className="text-foreground" />
        </Animated.View>
      ) : (
        <Animated.View key="sun" entering={ZoomIn} exiting={FadeOut}>
          <StyledIonicons name="sunny" size={18} className="text-foreground" />
        </Animated.View>
      )}
    </Button>
  );
}
