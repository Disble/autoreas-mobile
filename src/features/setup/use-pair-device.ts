import { useCallback, useState } from 'react';
import { withExclusiveWrite } from '../../infrastructure/db/client';
import {
  getExpoSQLiteUnavailableError,
  useOptionalSQLiteContext,
} from '../../infrastructure/db/native-runtime';
import { bridgeConfig } from '../../infrastructure/db/schema';

interface PairParams {
  ip: string;
  port: number | string;
  token: string;
}

interface PairResponse {
  device_id: string;
  device_name: string;
  auth_token: string;
}

export function usePairDevice() {
  const rawDb = useOptionalSQLiteContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pair = useCallback(
    async ({ ip, port, token }: PairParams) => {
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

        await withExclusiveWrite(rawDb, async (db) => {
          // Limpiar configs viejas si hubiese (asumimos solo 1 active device)
          await db.delete(bridgeConfig);
          // Insertar la nueva configuración
          await db.insert(bridgeConfig).values({
            ip,
            port: Number(port),
            token: data.auth_token, // Se almacena el auth_token, no el pairing_token
            deviceId: data.device_id,
            deviceName: data.device_name || 'AutoreasMobile',
          });
        });

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
