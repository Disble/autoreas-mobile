import { Ionicons } from '@expo/vector-icons';
import {
  Alert as HeroAlert,
  Button,
  Card,
  Input,
  Label,
  Separator,
  Spinner,
  Surface,
  TextField,
  cn,
} from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import type { SetupScreenProps } from './setup-screen.types';
import { useSetupScreen } from './use-setup-screen';

export function SetupScreen(props: SetupScreenProps) {
  const {
    error,
    ip,
    isLoading,
    port,
    token,
    setIp,
    setPort,
    setToken,
    handlePair,
  } = useSetupScreen(props);

  return (
    <View className="flex-1 justify-center bg-background px-6">
      <View className="mb-8 items-center">
        <Surface className="mb-4 rounded-full p-4" variant="secondary">
          <Ionicons color="#6366f1" name="link-outline" size={32} />
        </Surface>
        <AppText className="mb-1 text-3xl font-bold tracking-tight text-foreground">
          Autoreas
        </AppText>
        <AppText className="max-w-[260px] text-center text-sm text-muted">
          Conectá tu dispositivo con el Bridge para sincronizar tu lista de animes.
        </AppText>
      </View>

      <Card className="p-5">
        <Card.Body className="gap-4">
          <TextField>
            <Label>
              <Label.Text>Dirección IP</Label.Text>
            </Label>
            <Input
              autoCapitalize="none"
              keyboardType="decimal-pad"
              onChangeText={setIp}
              placeholder="Ej: 192.168.1.10"
              value={ip}
            />
          </TextField>

          <TextField>
            <Label>
              <Label.Text>Puerto</Label.Text>
            </Label>
            <Input
              keyboardType="number-pad"
              onChangeText={setPort}
              placeholder="8080"
              value={port}
            />
          </TextField>

          <TextField>
            <Label>
              <Label.Text>Token de emparejamiento</Label.Text>
            </Label>
            <Input
              autoCapitalize="none"
              onChangeText={setToken}
              placeholder="Token mostrado en el Bridge"
              secureTextEntry
              value={token}
            />
          </TextField>

          {error ? (
            <HeroAlert status="danger">
              <HeroAlert.Indicator />
              <HeroAlert.Content>
                <HeroAlert.Description>{error}</HeroAlert.Description>
              </HeroAlert.Content>
            </HeroAlert>
          ) : null}

          <Separator className="my-1" />

          <Button
            className={cn('w-full', isLoading && 'opacity-80')}
            isDisabled={isLoading}
            onPress={handlePair}
            size="lg"
            variant="primary"
          >
            {isLoading ? (
              <Spinner className="text-white" />
            ) : (
              <Button.Label>Emparejar Bridge</Button.Label>
            )}
          </Button>
        </Card.Body>
      </Card>

      <AppText className="mt-6 text-center text-xs text-muted">
        También podés usar el deep link autoreas://pair desde el Bridge.
      </AppText>
    </View>
  );
}
