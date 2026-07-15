import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";
import type { AnimeListScreenHeaderLeftProps } from "./anime-list-screen.types";

/** Renders the anime list screen header left interface. */
export function AnimeListScreenHeaderLeft({
  handleOpenSettings,
  themeColorForeground,
}: Readonly<AnimeListScreenHeaderLeftProps>) {
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