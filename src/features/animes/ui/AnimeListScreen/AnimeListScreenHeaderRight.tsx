import { Ionicons } from "@expo/vector-icons";
import { Button } from "heroui-native";
import type { AnimeListScreenHeaderRightProps } from "./anime-list-screen.types";

export function AnimeListScreenHeaderRight({
  refreshAccessibilityLabel,
  isRefreshing,
  themeColorForeground,
  handleRefresh,
}: AnimeListScreenHeaderRightProps) {
  return (
    <Button
      accessibilityLabel={refreshAccessibilityLabel}
      isDisabled={isRefreshing}
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