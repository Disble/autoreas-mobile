import { Ionicons } from '@expo/vector-icons';
import { useURL } from 'expo-linking';
import { Href, useRouter } from 'expo-router';
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
  useToast,
} from 'heroui-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppText } from '../../components/app-text';
import { usePairDevice } from '../../features/setup/use-pair-device';

export default function SetupScreen() {
  const router = useRouter();
  const { pair, isLoading, error } = usePairDevice();
  const { toast } = useToast();
  const url = useURL();

  const [ip, setIp] = useState('');
  const [port, setPort] = useState('8080');
  const [token, setToken] = useState('');

  useEffect(() => {
    if (url) {
      try {
        const parsedUrl = new URL(url);
        if (
          parsedUrl.protocol.replace(':', '') === 'autoreas' &&
          parsedUrl.hostname === 'pair'
        ) {
          const params = new URLSearchParams(parsedUrl.search);
          const ipParam = params.get('ip');
          const portParam = params.get('port');
          const tokenParam = params.get('token');

          if (ipParam) setIp(ipParam);
          if (portParam) setPort(portParam);
          if (tokenParam) setToken(tokenParam);

          toast.show({
            variant: 'accent',
            label: 'Deep link detectado',
            description: 'Campos completados automáticamente.',
            duration: 3000,
          });
        }
      } catch {
        console.warn('Invalid deep link URL:', url);
      }
    }
  }, [url, toast]);

  const handlePair = async () => {
    if (!ip || !port || !token) {
      toast.show({
        variant: 'warning',
        label: 'Campos incompletos',
        description: 'Todos los campos son obligatorios.',
        duration: 3000,
      });
      return;
    }

    const portNumber = parseInt(port, 10);
    if (isNaN(portNumber)) {
      toast.show({
        variant: 'warning',
        label: 'Puerto inválido',
        description: 'El puerto debe ser un número válido.',
        duration: 3000,
      });
      return;
    }

    const { success, error: pairError } = await pair({ ip, port: portNumber, token });

    if (success) {
      toast.show({
        variant: 'success',
        label: 'Emparejado correctamente',
        duration: 2000,
      });
      router.replace('/(tabs)' as Href);
    } else {
      toast.show({
        variant: 'danger',
        label: 'Error de conexión',
        description: pairError || 'No se pudo conectar con el Bridge.',
        duration: 5000,
      });
    }
  };

  return (
    <View className="flex-1 justify-center bg-background px-6">
      <View className="mb-8 items-center">
        <Surface variant="secondary" className="rounded-full p-4 mb-4">
          <Ionicons name="link-outline" size={32} color="#6366f1" />
        </Surface>
        <AppText className="mb-1 text-3xl font-bold text-foreground tracking-tight">
          Autoreas
        </AppText>
        <AppText className="text-center text-sm text-muted max-w-[260px]">
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
              placeholder="Ej: 192.168.1.10"
              value={ip}
              onChangeText={setIp}
              keyboardType="decimal-pad"
              autoCapitalize="none"
            />
          </TextField>

          <TextField>
            <Label>
              <Label.Text>Puerto</Label.Text>
            </Label>
            <Input
              placeholder="8080"
              value={port}
              onChangeText={setPort}
              keyboardType="number-pad"
            />
          </TextField>

          <TextField>
            <Label>
              <Label.Text>Token de emparejamiento</Label.Text>
            </Label>
            <Input
              placeholder="Token mostrado en el Bridge"
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              secureTextEntry
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
            variant="primary"
            size="lg"
            onPress={handlePair}
            isDisabled={isLoading}
            className={cn('w-full', isLoading && 'opacity-80')}
          >
            {isLoading ? (
              <Spinner className="text-white" />
            ) : (
              <Button.Label>Emparejar Bridge</Button.Label>
            )}
          </Button>
        </Card.Body>
      </Card>

      <AppText className="text-center text-xs text-muted mt-6">
        También podés usar el deep link autoreas://pair desde el Bridge.
      </AppText>
    </View>
  );
}
