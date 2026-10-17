import { useEffect, useRef } from 'react';
import { bridgeClient } from '../../infrastructure/api';
import { getBridgeConfigSnapshot } from '../../infrastructure/db/client/client.helpers';
import { useOptionalSQLiteContext } from '../../infrastructure/db/native-runtime/native-runtime.helpers';
import { recordDiagnosticEvent } from '../sync/sync-diagnostic-store/sync-diagnostic-store.helpers';
import { WsMessageSchema } from './websocket.schema';
import type { UseWebSocketProps } from './websocket.types';

/** Coordinates web socket state and actions. */
export function useWebSocket({
  enabled = true,
  onSeasonChanged,
  onSyncRequired,
  onPreferencesChanged,
  onReconnected,
  onDisconnected,
}: UseWebSocketProps = {}) {
  // 1. Refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);
  const onSeasonChangedRef = useRef(onSeasonChanged);
  const onSyncRequiredRef = useRef(onSyncRequired);
  const onPreferencesChangedRef = useRef(onPreferencesChanged);
  const onReconnectedRef = useRef(onReconnected);
  const onDisconnectedRef = useRef(onDisconnected);

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
    onReconnectedRef.current = onReconnected;
  }, [onReconnected]);

  useEffect(() => {
    onDisconnectedRef.current = onDisconnected;
  }, [onDisconnected]);

  // eslint-disable-next-line react-doctor/effect-needs-cleanup -- the reconnect timer is set from socket callbacks; the returned cleanup (`disconnect`) clears the pending one and closes the socket, and `isMounted` stops a fired one from reconnecting.
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
    // One connection session per effect run (ADR 009 R-7). An open is a reconnect when the session
    // already opened once, or already failed an attempt: the mount or resume flush covers only a
    // first attempt that succeeds, so a bridge that was down at mount still gets its catch-up.
    let hasOpenedInSession = false;
    let hadFailedAttemptInSession = false;

    const scheduleReconnect = () => {
      hadFailedAttemptInSession = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      const backoffSeconds = Math.min(Math.pow(2, reconnectAttemptRef.current), 30);
      reconnectAttemptRef.current += 1;
      // Separates "the socket is retrying" from "the socket gave up". Both look like silence
      // from the bridge, and only one of them is a bug.
      recordDiagnosticEvent({
        source: 'websocket',
        event: 'ws_reconnect_scheduled',
        at: Date.now(),
      });

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
        // Per socket: only the drop of a socket that opened is a disconnect (ADR 009 R-9).
        let didOpen = false;

        ws.onopen = () => {
          didOpen = true;
          reconnectAttemptRef.current = 0;
          // Two opens milliseconds apart is how the duplicate-socket bug shows itself, and
          // there is no other way to see it off-device: from the bridge, one live socket and
          // two look identical until one of them is orphaned.
          recordDiagnosticEvent({ source: 'websocket', event: 'ws_opened', at: Date.now() });

          if (hasOpenedInSession || hadFailedAttemptInSession) {
            onReconnectedRef.current?.();
          }

          hasOpenedInSession = true;
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
          recordDiagnosticEvent({ source: 'websocket', event: 'ws_closed', at: Date.now() });

          if (isMounted && enabled) {
            scheduleReconnect();

            // A close the cleanup caused (unmount, disable, backgrounding) lands with
            // `isMounted` false and is not reported.
            if (didOpen) {
              onDisconnectedRef.current?.();
            }
          }
        };

        ws.onerror = () => {
          // onerror generally followed by onclose
          recordDiagnosticEvent({ source: 'websocket', event: 'ws_error', at: Date.now() });
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
