import { useEffect, useRef } from 'react';
import { bridgeClient } from '../../infrastructure/api';
import { getBridgeConfigSnapshot } from '../../infrastructure/db/client';
import { useOptionalSQLiteContext } from '../../infrastructure/db/native-runtime';
import { WsMessageSchema } from './websocket.schema';
import type { UseWebSocketProps } from './websocket.types';

export function useWebSocket({ enabled = true, onSyncRequired }: UseWebSocketProps = {}) {
  // 1. Refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);
  const onSyncRequiredRef = useRef(onSyncRequired);

  // 2. State

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)

  // 6. Callbacks (`useCallback` calling pure helpers)

  // 7. Effects
  useEffect(() => {
    onSyncRequiredRef.current = onSyncRequired;
  }, [onSyncRequired]);

  useEffect(() => {
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

    if (!enabled || !rawDb) {
      disconnect();
      return;
    }

    let isMounted = true;

    const scheduleReconnect = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      const backoffSeconds = Math.min(Math.pow(2, reconnectAttemptRef.current), 30);
      reconnectAttemptRef.current += 1;

      reconnectTimeoutRef.current = setTimeout(() => {
        if (isMounted && enabled) {
          void connect();
        }
      }, backoffSeconds * 1000);
    };

    const connect = async () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        return;
      }

      if (wsRef.current?.readyState === WebSocket.CONNECTING) {
        return;
      }

      try {
        const config = await getBridgeConfigSnapshot(rawDb);

        if (!config?.ip || !config?.port || !config?.token || !isMounted || !enabled) {
          return;
        }

        const ws = bridgeClient.openWebSocket({
          ip: config.ip,
          port: config.port,
          token: config.token,
        });

        wsRef.current = ws;

        ws.onopen = () => {
          reconnectAttemptRef.current = 0;
        };

        ws.onmessage = async (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            const parsed = WsMessageSchema.parse(data);

            // Every anime event (created/changed/deleted) carries only `anime_id` -- it has no
            // `changed_fields`/`timestamp`, so it cannot safely drive a targeted write on its
            // own. Funnel ALL of them through the same reconcile trigger `sync_required` uses:
            // reconcile is the only path that carries the rich shape the merge boundary needs
            // (changed_fields + timestamp + snapshot), with the staleness guard and outbox
            // protection applied. This intentionally replaces the old GET-then-clobber writer.
            if (
              parsed.type === 'sync_required' ||
              parsed.type === 'anime_changed' ||
              parsed.type === 'anime_created' ||
              parsed.type === 'anime_deleted'
            ) {
              onSyncRequiredRef.current?.();
              return;
            }
          } catch (error) {
            console.error('Error processing WS message', error);
          }
        };

        ws.onclose = () => {
          wsRef.current = null;

          if (isMounted && enabled) {
            scheduleReconnect();
          }
        };

        ws.onerror = () => {
          // onerror generally followed by onclose
        };
      } catch (error) {
        console.error('Error in connect WS:', error);

        if (isMounted && enabled) {
          scheduleReconnect();
        }
      }
    };

    void connect();

    return () => {
      isMounted = false;
      disconnect();
    };
  }, [enabled, rawDb]);

  return {};
}
