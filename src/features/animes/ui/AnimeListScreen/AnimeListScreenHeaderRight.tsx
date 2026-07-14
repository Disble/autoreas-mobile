import { Ionicons } from "@expo/vector-icons";
import { Button } from "heroui-native";
import type { AnimeListScreenHeaderRightProps } from "./anime-list-screen.types";

/** Renders the anime list screen header right interface. */
export function AnimeListScreenHeaderRight({
  refreshAccessibilityLabel,
  isRefreshing,
  isManualSyncEnabled,
  themeColorForeground,
  handleRefresh,
}: Readonly<AnimeListScreenHeaderRightProps>) {
  return (
    <Button
      accessibilityLabel={refreshAccessibilityLabel}
      isDisabled={isRefreshing || !isManualSyncEnabled}
      isIconOnly
      onPress={() => {
        void handleRefresh();
      }}
      size="sm"
      variant="ghost"
    >
      <Ionicons name="refresh" color={themeColorForeground} size={20} />
    </Button>
  );
}
