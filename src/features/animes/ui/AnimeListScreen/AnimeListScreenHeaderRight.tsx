import { Ionicons } from "@expo/vector-icons";
import { Button } from "heroui-native";
import { View } from "react-native";
import { SyncStatusButton } from "../SyncStatusControl/SyncStatusButton";
import type { AnimeListScreenHeaderRightProps } from "./anime-list-screen.types";

/** Renders the bar's fixed-width end column: the sync status button, then manual refresh. */
export function AnimeListScreenHeaderRight({
  refreshAccessibilityLabel,
  isRefreshing,
  isManualSyncEnabled,
  sideColumnStyle,
  syncStatus,
  themeColorForeground,
  handleOpenSyncSheet,
  handleRefreshPress,
}: Readonly<AnimeListScreenHeaderRightProps>) {
  return (
    <View className="flex-row items-center justify-end gap-1" style={sideColumnStyle}>
      <SyncStatusButton onPress={handleOpenSyncSheet} status={syncStatus} />
      <Button
        accessibilityLabel={refreshAccessibilityLabel}
        className="size-11 rounded-full"
        isDisabled={isRefreshing || !isManualSyncEnabled}
        isIconOnly
        onPress={handleRefreshPress}
        variant="ghost"
      >
        <Ionicons name="refresh" color={themeColorForeground} size={22} />
      </Button>
    </View>
  );
}
