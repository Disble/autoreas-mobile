/* eslint-disable react-doctor/jsx-max-depth -- HeroUI BottomSheet compound shape (BottomSheet > Portal > Content > ...) sets the depth before any content starts. */
import { BottomSheet, Button } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { StyledIonicons } from '../../../../components/theme-toggle.constants';
import {
  ANIME_FOLDER_SETUP_DESCRIPTION,
  ANIME_FOLDER_SETUP_NOTE,
  ANIME_FOLDER_SETUP_STEPS,
  ANIME_FOLDER_SETUP_TITLE,
} from './anime-folder-setup-sheet.constants';
import type { AnimeFolderSetupSheetProps } from './anime-folder-setup-sheet.types';
import { SheetContent } from '../../../../components/sheet-content';

/** Renders the guided onboarding sheet shown before the system folder picker. */
export function AnimeFolderSetupSheet(props: Readonly<AnimeFolderSetupSheetProps>) {
  const { isOpen, onClose, onChoose } = props;

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onClose}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <SheetContent isOpen={isOpen} contentContainerClassName="flex-none gap-5 p-5 pb-safe-offset-5">
          <View className="flex-row items-start gap-4">
            <View className="bg-accent-soft h-14 w-14 items-center justify-center rounded-2xl">
              <StyledIonicons name="folder-open" size={28} className="text-accent-soft-foreground" />
            </View>
            <View className="flex-1 gap-1">
              <BottomSheet.Title className="text-foreground text-lg font-semibold">
                {ANIME_FOLDER_SETUP_TITLE}
              </BottomSheet.Title>
              <AppText className="text-muted text-sm">{ANIME_FOLDER_SETUP_DESCRIPTION}</AppText>
            </View>
          </View>

          <View className="flex-row gap-3">
            {ANIME_FOLDER_SETUP_STEPS.map((step, index) => (
              <View key={step} className="bg-surface-secondary flex-1 gap-1 rounded-2xl px-4 py-3">
                <AppText className="text-accent text-xs font-semibold">{`PASO ${index + 1}`}</AppText>
                <AppText className="text-foreground text-sm">{step}</AppText>
              </View>
            ))}
          </View>

          <View className="flex-row items-center gap-2">
            <StyledIonicons name="lock-closed-outline" size={16} className="text-muted" />
            <AppText className="text-muted flex-1 text-xs">{ANIME_FOLDER_SETUP_NOTE}</AppText>
          </View>

          <View className="flex-row justify-end gap-2">
            <Button size="sm" variant="ghost" onPress={onClose}>
              <Button.Label>Ahora no</Button.Label>
            </Button>
            <Button size="sm" variant="primary" onPress={onChoose}>
              <Button.Label>Elegir carpeta</Button.Label>
            </Button>
          </View>
        </SheetContent>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
