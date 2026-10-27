import { Alert, Button } from 'heroui-native';
import { View } from 'react-native';
import { AnimeFolderSetupSheet } from '../AnimeFolderSetupSheet';
import { ANIME_FOLDER_HINT_COPY, ANIME_FOLDER_LOST_COPY } from './anime-folder-banner.constants';
import { useAnimeFolderBanner } from './use-anime-folder-banner';

/** Renders the anime folder hint (accent, soft) or the lost-access banner (danger, soft). */
export function AnimeFolderBanner() {
  const {
    kind,
    isSetupSheetOpen,
    handleDismiss,
    handleOpenSetupSheet,
    handleCloseSetupSheet,
    handleChooseFromSheet,
    handleChooseAgain,
  } = useAnimeFolderBanner();

  if (kind === 'lost') {
    return (
      <View className="pt-3">
        <Alert status="danger" className="bg-danger-soft">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{ANIME_FOLDER_LOST_COPY.title}</Alert.Title>
            <Alert.Description>{ANIME_FOLDER_LOST_COPY.description}</Alert.Description>
          </Alert.Content>
          <Button size="sm" variant="secondary" onPress={handleChooseAgain}>
            <Button.Label>Elegir de nuevo</Button.Label>
          </Button>
        </Alert>
      </View>
    );
  }

  return (
    <>
      {kind === 'hint' ? (
        <View className="pt-3">
          <Alert status="accent" className="bg-accent-soft">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{ANIME_FOLDER_HINT_COPY.title}</Alert.Title>
              <Alert.Description>{ANIME_FOLDER_HINT_COPY.description}</Alert.Description>
            </Alert.Content>
            <View className="flex-row gap-2">
              <Button size="sm" variant="ghost" onPress={handleDismiss}>
                <Button.Label>Ahora no</Button.Label>
              </Button>
              <Button size="sm" variant="primary" onPress={handleOpenSetupSheet}>
                <Button.Label>Elegir carpeta</Button.Label>
              </Button>
            </View>
          </Alert>
        </View>
      ) : null}
      <AnimeFolderSetupSheet
        isOpen={isSetupSheetOpen}
        onClose={handleCloseSetupSheet}
        onChoose={handleChooseFromSheet}
      />
    </>
  );
}
