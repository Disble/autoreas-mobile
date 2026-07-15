import { ScrollView } from 'react-native';
import Animated from 'react-native-reanimated';

/** Provides a stable animated ScrollView component shared across renders. */
export const AnimatedScreenScrollView = Animated.createAnimatedComponent(ScrollView);
