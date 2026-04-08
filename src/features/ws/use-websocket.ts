import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { type SQLiteDatabase } from 'expo-sqlite';
import { and, eq, sql } from 'drizzle-orm';
import { getBridgeConfigSnapshot, withExclusiveWrite } from '../../infrastructure/db/client';
import { useOptionalSQLiteContext } from '../../infrastructure/db/native-runtime';
import { animes, operationLog } from '../../infrastructure/db/schema';
import { z } from 'zod';

const AnimeChangedEventSchema = z.object({
  type: z.literal('anime_changed'),
  anime_id: z.string(),
  payload: z.object({
    estado: z.number().optional(),
    nrocapvisto: z.number().optional(),
    dias: z.string().optional(),
  }),
});

const SyncRequiredEventSchema = z.object({
  type: z.literal('sync_required'),
});

const WsMessageSchema = z.union([AnimeChangedEventSchema, SyncRequiredEventSchema]);

interface UseWebSocketProps {
  onSyncRequired?: () => void;
}

export function useWebSocket({ onSyncRequired }: UseWebSocketProps = {}) {
  const rawDb = useOptionalSQLiteContext();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    if (!rawDb) {
      return;
    }

    let isMounted = true;

    const connect = async () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

      try {
        const config = await getBridgeConfigSnapshot(rawDb);
        if (!config?.ip || !config?.port || !config?.token || !isMounted) return;

        const url = `ws://${config.ip}:${config.port}/ws`;
        
        // Native React Native WebSocket supports passing headers as third param options
        const ws = new (WebSocket as any)(url, null, {
          headers: {
            Authorization: `Bearer ${config.token}`,
          },
        });

        wsRef.current = ws;

        ws.onopen = () => {
          reconnectAttemptRef.current = 0;
        };

        ws.onmessage = async (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            const parsed = WsMessageSchema.parse(data);

            if (parsed.type === 'sync_required') {
              onSyncRequired?.();
            } else if (parsed.type === 'anime_changed') {
              const { anime_id, payload } = parsed;

              if (Object.keys(payload).length === 0) return;

              await withExclusiveWrite(rawDb, async (db) => {
                const result = await db
                  .select({ count: sql<number>`cast(count(*) as integer)` })
                  .from(operationLog)
                  .where(
                    and(
                      eq(operationLog.animeId, anime_id),
                      eq(operationLog.status, 'pending')
                    )
                  );

                const count = result[0]?.count ?? 0;

                if (count === 0) {
                  await db
                    .update(animes)
                    .set(payload)
                    .where(eq(animes._id, anime_id));
                }
              });
            }
          } catch (err) {
            console.error('Error processing WS message', err);
          }
        };

        ws.onclose = () => {
          wsRef.current = null;
          if (isMounted && appStateRef.current === 'active') {
            scheduleReconnect();
          }
        };

        ws.onerror = () => {
          // onerror generally followed by onclose
        };
      } catch (err) {
        console.error('Error in connect WS:', err);
        if (isMounted && appStateRef.current === 'active') {
          scheduleReconnect();
        }
      }
    };

    const scheduleReconnect = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      
      const backoffSecs = Math.min(Math.pow(2, reconnectAttemptRef.current), 30);
      reconnectAttemptRef.current += 1;
      
      reconnectTimeoutRef.current = setTimeout(() => {
        if (isMounted && appStateRef.current === 'active') {
          connect();
        }
      }, backoffSecs * 1000);
    };

    const disconnect = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      appStateRef.current = nextAppState;
      if (nextAppState === 'active') {
        reconnectAttemptRef.current = 0;
        connect();
      } else if (nextAppState === 'background') {
        disconnect();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Initial connection
    if (appStateRef.current === 'active') {
      connect();
    }

    return () => {
      isMounted = false;
      subscription.remove();
      disconnect();
    };
  }, [onSyncRequired, rawDb]);

  return {};
}
