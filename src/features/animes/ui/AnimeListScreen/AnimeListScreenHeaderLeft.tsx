import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";
import type { AnimeListScreenHeaderLeftProps } from "./anime-list-screen.types";

export function AnimeListScreenHeaderLeft({
  handleOpenSettings,
  themeColorForeground,
}: AnimeListScreenHeaderLeftProps) {
  return (
    <Pressable
      accessibilityLabel="Abrir configuración"
      accessibilityRole="button"
      hitSlop={12}
      onPress={handleOpenSettings}
    >
      <Ionicons
        color={themeColorForeground}
        name="settings-outline"
        size={22}
      />
    </Pressable>
  );
}