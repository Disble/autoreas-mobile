import { useLinkingURL } from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useToast } from 'heroui-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePairDevice } from '../../use-pair-device';
import {
  buildSetupPairParams,
  getInvalidSetupPayloadFeedback,
  getSetupFormStateFromPayload,
  getSetupSourceFeedback,
  getSetupValidationMessage,
  parseSetupDeepLink,
} from './setup-screen.helpers';
import { SETUP_SCREEN_DEFAULT_PORT } from './setup-screen.constants';
import type {
  BridgePairingPayload,
  SetupScreenProps,
  SetupScreenFormState,
  SetupScreenViewModel,
} from './setup-screen.types';

/** Coordinates setup screen state and actions. */
export function useSetupScreen(_props: SetupScreenProps): SetupScreenViewModel {
  // 1. Refs
  const initialDeepLinkUrlRef = useRef<string | null>(null);
  const lastHandledDeepLinkUrlRef = useRef<string | null>(null);

  // 2. State
  const [ip, setIp] = useState('');
  const [port, setPort] = useState(SETUP_SCREEN_DEFAULT_PORT);
  const [token, setToken] = useState('');
  const [isScannerVisible, setIsScannerVisible] = useState(false);

  // 3. Context/3rd Party Hooks
  const router = useRouter();
  const { toast } = useToast();
  const localSearchParams = useLocalSearchParams<{ readonly repair?: string | string[] }>();
  const url = useLinkingURL();

  // 4. Queries/Mutations
  const { pair, isLoading, error } = usePairDevice();

  // 5. Derived State (useMemo)
  const formState = useMemo<SetupScreenFormState>(
    () => ({ ip, port, token }),
    [ip, port, token],
  );
  const isRepairNavigation = useMemo(() => {
    const repairParam = localSearchParams.repair;

    if (Array.isArray(repairParam)) {
      return repairParam.includes('1');
    }

    return repairParam === '1';
  }, [localSearchParams.repair]);

  // 6. Callbacks (useCallback calling pure helpers)
  const submitPairing = useCallback(
    async (nextFormState: SetupScreenFormState) => {
      const validationMessage = getSetupValidationMessage(nextFormState);

      if (validationMessage) {
        toast.show({
          variant: 'warning',
          label: validationMessage.includes('Puerto') ? 'Puerto inválido' : 'Campos incompletos',
          description: validationMessage,
          duration: 3000,
        });
        return;
      }

      const pairResult = await pair(buildSetupPairParams(nextFormState));

      if (pairResult.success) {
        toast.show({
          variant: 'success',
          label: 'Emparejado correctamente',
          duration: 2000,
        });
        router.replace('/(tabs)');
        return;
      }

      toast.show({
        variant: 'danger',
        label: 'Error de conexión',
        description: pairResult.error || 'No se pudo conectar con el Bridge.',
        duration: 5000,
      });
    },
    [pair, router, toast],
  );

  const handleAutofillPayload = useCallback(
    async (
      payload: BridgePairingPayload,
      source: 'deep-link' | 'qr',
    ) => {
      const nextFormState = getSetupFormStateFromPayload(payload);

      setIp(nextFormState.ip);
      setPort(nextFormState.port);
      setToken(nextFormState.token);
      setIsScannerVisible(false);

      const feedback = getSetupSourceFeedback(source);
      toast.show({
        variant: 'accent',
        label: feedback.label,
        description: feedback.description,
        duration: 3000,
      });

      await submitPairing(nextFormState);
    },
    [submitPairing, toast],
  );

  const handleIncomingPairingValue = useCallback(
    async (rawValue: string, source: 'deep-link' | 'qr') => {
      const parsedPayload = parseSetupDeepLink(rawValue);

      if (!parsedPayload) {
        const feedback = getInvalidSetupPayloadFeedback();
        toast.show({
          variant: 'warning',
          label: feedback.label,
          description: feedback.description,
          duration: 4000,
        });
        return;
      }

      await handleAutofillPayload(parsedPayload, source);
    },
    [handleAutofillPayload, toast],
  );

  const handlePair = useCallback(() => {
    submitPairing(formState).catch(() => undefined);
  }, [formState, submitPairing]);

  const handleToggleScanner = useCallback(() => {
    setIsScannerVisible((currentValue) => !currentValue);
  }, []);

  const handleCloseScanner = useCallback(() => {
    setIsScannerVisible(false);
  }, []);

  const handleQrScan = useCallback((rawValue: string) => {
    void handleIncomingPairingValue(rawValue, 'qr');
  }, [handleIncomingPairingValue]);

  // 7. Effects
  useEffect(() => {
    if (initialDeepLinkUrlRef.current === null && url) {
      initialDeepLinkUrlRef.current = url;
    }

    if (!url || url === lastHandledDeepLinkUrlRef.current) {
      return;
    }

    if (isRepairNavigation && url === initialDeepLinkUrlRef.current) {
      lastHandledDeepLinkUrlRef.current = url;
      return;
    }

    lastHandledDeepLinkUrlRef.current = url;
    void handleIncomingPairingValue(url, 'deep-link');
  }, [handleIncomingPairingValue, isRepairNavigation, url]);

  return {
    error,
    ip,
    isLoading,
    isScannerVisible,
    port,
    token,
    setIp,
    setPort,
    setToken,
    handleCloseScanner,
    handlePair,
    handleQrScan,
    handleToggleScanner,
  };
}
