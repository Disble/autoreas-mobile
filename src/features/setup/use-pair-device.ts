import { useCallback, useState } from 'react';
import {
  getExpoSQLiteUnavailableError,
  useOptionalSQLiteContext,
} from '../../infrastructure/db/native-runtime';
import {
  fetchInitialSyncSnapshot,
  persistPairedBridgeConfiguration,
} from '../sync/initial-sync.helpers';
import {
  buildInitialSyncFailureMessage,
  buildPairRequestFailureMessage,
  buildPairResponseValidationFailureMessage,
  getMissingPairResponseFields,
} from './pair-device.helpers';
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
          throw new Error(
            buildPairRequestFailureMessage({
              status: response.status,
            }),
          );
        }

        const data = (await response.json()) as PairResponse;
        const missingFields = getMissingPairResponseFields(data);

        if (missingFields.length > 0) {
          throw new Error(
            buildPairResponseValidationFailureMessage({
              missingFields,
            }),
          );
        }

        const stagedBridgeConfig = {
          ip,
          port: Number(port),
          token: data.auth_token,
          deviceId: data.device_id,
          deviceName: data.device_name || 'AutoreasMobile',
        };

        let remoteAnimes: Awaited<ReturnType<typeof fetchInitialSyncSnapshot>>;

        try {
          remoteAnimes = await fetchInitialSyncSnapshot(stagedBridgeConfig);
        } catch (err: unknown) {
          const cause = err instanceof Error ? err.message : 'Unknown error occurred';

          throw new Error(
            buildInitialSyncFailureMessage({
              cause,
            }),
          );
        }

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
