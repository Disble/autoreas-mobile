import { useURL } from 'expo-linking';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useToast } from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import { usePairDevice } from '../../use-pair-device';
import {
  getSetupValidationMessage,
  parseSetupDeepLink,
} from './setup-screen.helpers';
import type {
  SetupScreenProps,
  SetupScreenViewModel,
} from './setup-screen.types';

export function useSetupScreen(_props: SetupScreenProps): SetupScreenViewModel {
  // 1. Refs

  // 2. State
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('8080');
  const [token, setToken] = useState('');

  // 3. Context/3rd Party Hooks
  const router = useRouter();
  const { toast } = useToast();
  const url = useURL();

  // 4. Queries/Mutations
  const { pair, isLoading, error } = usePairDevice();

  // 5. Derived State (useMemo)

  // 6. Callbacks (useCallback calling pure helpers)
  const handlePair = useCallback(async () => {
    const validationMessage = getSetupValidationMessage({ ip, port, token });

    if (validationMessage) {
      toast.show({
        variant: 'warning',
        label: validationMessage.includes('Puerto') ? 'Puerto inválido' : 'Campos incompletos',
        description: validationMessage,
        duration: 3000,
      });
      return;
    }

    const pairResult = await pair({
      ip,
      port: Number.parseInt(port, 10),
      token,
    });

    if (pairResult.success) {
      toast.show({
        variant: 'success',
        label: 'Emparejado correctamente',
        duration: 2000,
      });
      router.replace('/(tabs)' as Href);
      return;
    }

    toast.show({
      variant: 'danger',
      label: 'Error de conexión',
      description: pairResult.error || 'No se pudo conectar con el Bridge.',
      duration: 5000,
    });
  }, [ip, pair, port, router, toast, token]);

  // 7. Effects
  useEffect(() => {
    if (!url) {
      return;
    }

    try {
      const deepLinkState = parseSetupDeepLink(url);

      if (!deepLinkState) {
        return;
      }

      if (deepLinkState.ip) {
        setIp(deepLinkState.ip);
      }

      if (deepLinkState.port) {
        setPort(deepLinkState.port);
      }

      if (deepLinkState.token) {
        setToken(deepLinkState.token);
      }

      toast.show({
        variant: 'accent',
        label: 'Deep link detectado',
        description: 'Campos completados automáticamente.',
        duration: 3000,
      });
    } catch {
      console.warn('Invalid deep link URL:', url);
    }
  }, [toast, url]);

  return {
    error,
    ip,
    isLoading,
    port,
    token,
    setIp,
    setPort,
    setToken,
    handlePair,
  };
}
