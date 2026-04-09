import { useURL } from 'expo-linking';
import { Href, useRouter } from 'expo-router';
import {
  Alert as HeroAlert,
  Button,
  Card,
  Input,
  Label,
  Spinner,
  TextField,
  cn,
} from 'heroui-native';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { AppText } from '../../components/app-text';
import { usePairDevice } from '../../features/setup/use-pair-device';

export default function SetupScreen() {
  const router = useRouter();
  const { pair, isLoading, error } = usePairDevice();
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
        }
      } catch {
        console.warn('Invalid deep link URL:', url);
      }
    }
  }, [url]);

  const handlePair = async () => {
    if (!ip || !port || !token) {
      Alert.alert('Error', 'Todos los campos son obligatorios');
      return;
    }

    const portNumber = parseInt(port, 10);
    if (isNaN(portNumber)) {
      Alert.alert('Error', 'El puerto debe ser un número válido');
      return;
    }

    const { success, error: pairError } = await pair({ ip, port: portNumber, token });

    if (success) {
      router.replace('/(tabs)' as Href);
    } else {
      Alert.alert('Error de conexión', pairError || 'No se pudo conectar con el Bridge');
    }
  };

  return (
    <View className="flex-1 justify-center bg-background px-6">
      <View className="mb-10 items-center">
        <AppText className="mb-2 text-4xl font-bold text-foreground tracking-tight">
          Autoreas
        </AppText>
        <AppText className="text-center text-base text-muted">
          Ingresa los datos de tu Bridge para emparejar el dispositivo.
        </AppText>
      </View>

      <Card className="p-5">
        <Card.Body className="gap-5">
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

          <Button
            variant="primary"
            size="lg"
            onPress={handlePair}
            isDisabled={isLoading}
            className={cn('mt-2 w-full', isLoading && 'opacity-80')}
          >
            {isLoading ? (
              <Spinner className="text-white" />
            ) : (
              <Button.Label>Emparejar Bridge</Button.Label>
            )}
          </Button>
        </Card.Body>
      </Card>
    </View>
  );
}
