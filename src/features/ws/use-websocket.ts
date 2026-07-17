import { useEffect, useRef } from 'react';
import { bridgeClient } from '../../infrastructure/api';
import { getBridgeConfigSnapshot } from '../../infrastructure/db/client/client.helpers';
import { useOptionalSQLiteContext } from '../../infrastructure/db/native-runtime/native-runtime.helpers';
import { WsMessageSchema } from './websocket.schema';
import type { UseWebSocketProps } from './websocket.types';

/** Coordinates web socket state and actions. */
export function useWebSocket({
  enabled = true,
  onSeasonChanged,
  onSyncRequired,
  onPreferencesChanged,
}: UseWebSocketProps = {}) {
  // 1. Refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);
  const onSeasonChangedRef = useRef(onSeasonChanged);
  const onSyncRequiredRef = useRef(onSyncRequired);
  const onPreferencesChangedRef = useRef(onPreferencesChanged);

  // 2. State

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)

  // 6. Callbacks (`useCallback` calling pure helpers)

  // 7. Effects
  useEffect(() => {
    onSeasonChangedRef.current = onSeasonChanged;
  }, [onSeasonChanged]);

  useEffect(() => {
    onSyncRequiredRef.current = onSyncRequired;
  }, [onSyncRequired]);

  useEffect(() => {
    onPreferencesChangedRef.current = onPreferencesChanged;
  }, [onPreferencesChanged]);

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

        ws.onmessage = (event: MessageEvent) => {
          if (typeof event.data !== 'string') {
            return;
          }

          let data: unknown;
          try {
            data = JSON.parse(event.data) as unknown;
          } catch {
            // Non-JSON frame: ignore rather than crash the socket handler.
            return;
          }

          const result = WsMessageSchema.safeParse(data);
          if (!result.success) {
            // Unrecognized message type (e.g. a newer bridge added one this client
            // does not know yet). Ignore it quietly so forward-incompatible frames
            // never surface as a runtime error box -- the contract stays additive.
            return;
          }

          const parsed = result.data;

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

          if (parsed.type === 'season_changed') {
            onSeasonChangedRef.current?.();
            return;
          }

          // Bridge-owned preference push: the season-mode flag changed. This is NOT an
          // anime data change, so it must not trigger a reconcile -- it carries its own
          // value and updates the global season-mode store directly via the callback.
          if (parsed.type === 'preferences_changed') {
            onPreferencesChangedRef.current?.(parsed.season_mode);
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
