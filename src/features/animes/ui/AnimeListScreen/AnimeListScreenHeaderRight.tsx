import { Ionicons } from "@expo/vector-icons";
import { Button } from "heroui-native";
import type { AnimeListScreenHeaderRightProps } from "./anime-list-screen.types";

export function AnimeListScreenHeaderRight({
  refreshAccessibilityLabel,
  isRefreshing,
  isManualSyncEnabled,
  themeColorForeground,
  handleRefresh,
}: AnimeListScreenHeaderRightProps) {
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
