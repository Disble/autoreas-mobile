import { useCallback, useState } from 'react';
import {
  getExpoSQLiteUnavailableError,
  useOptionalSQLiteContext,
} from '../../infrastructure/db/native-runtime';
import {
  fetchInitialSyncSnapshot,
  persistPairedBridgeConfiguration,
} from '../sync/initial-sync.helpers';
import type { PairDeviceResult, PairParams, PairResponse } from './pair-device.types';

export function usePairDevice() {
  const rawDb = useOptionalSQLiteContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pair = useCallback(
    async ({ ip, port, token }: PairParams): Promise<PairDeviceResult> => {
      setIsLoading(true);
      setError(null);

      try {
        if (!rawDb) {
          throw getExpoSQLiteUnavailableError();
        }

        const url = `http://${ip}:${port}/api/devices/pair`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pairing_token: token,
            device_name: 'AutoreasMobile',
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to pair: ${response.status}`);
        }

        const data = (await response.json()) as PairResponse;

        if (!data.device_id || !data.auth_token) {
          throw new Error('Invalid response from bridge');
        }

        const stagedBridgeConfig = {
          ip,
          port: Number(port),
          token: data.auth_token,
          deviceId: data.device_id,
          deviceName: data.device_name || 'AutoreasMobile',
        };

        const remoteAnimes = await fetchInitialSyncSnapshot(stagedBridgeConfig);

        await persistPairedBridgeConfiguration(rawDb, stagedBridgeConfig, remoteAnimes);

        return { success: true, data };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error occurred';
        setError(msg);
        return { success: false, error: msg };
      } finally {
        setIsLoading(false);
      }
    },
    [rawDb]
  );

  return {
    pair,
    isLoading,
    error,
  };
}
