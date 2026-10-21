import { Ionicons } from "@expo/vector-icons";
import { Button } from "heroui-native";
import { View } from "react-native";
import type { AnimeListScreenHeaderLeftProps } from "./anime-list-screen.types";

/** Renders the bar's fixed-width start column with the settings button. */
export function AnimeListScreenHeaderLeft({
  handleOpenSettings,
  sideColumnStyle,
  themeColorForeground,
}: Readonly<AnimeListScreenHeaderLeftProps>) {
  return (
    <View className="flex-row items-center" style={sideColumnStyle}>
      <Button
        accessibilityLabel="Abrir configuración"
        className="size-11 rounded-full"
        isIconOnly
        onPress={handleOpenSettings}
        variant="ghost"
      >
        <Ionicons color={themeColorForeground} name="settings-outline" size={22} />
      </Button>
    </View>
  );
}
