import { useCallback, useState } from 'react';
import { bridgeClient } from '../../infrastructure/api';
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

/** Coordinates pair device state and actions. */
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

        const result = await bridgeClient.pairDevice(
          { ip, port: Number(port) },
          { pairingToken: token, deviceName: 'AutoreasMobile' },
        );

        if (!result.ok) {
          throw new Error(
            buildPairRequestFailureMessage({
              status: result.status,
            }),
          );
        }

        const data = result.data as PairResponse;
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
            { cause: err },
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
