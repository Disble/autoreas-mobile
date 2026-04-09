import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { getBridgeConfigSnapshot } from "../../infrastructure/db/client";
import { useOptionalSQLiteContext } from "../../infrastructure/db/native-runtime";
import {
  deleteAnimeLocally,
  upsertAnimeFromBridge,
} from "../sync/use-initial-sync";
import { WsMessageSchema } from "./websocket.schema";
import type { UseWebSocketProps } from "./websocket.types";

export function useWebSocket({ onSyncRequired }: UseWebSocketProps = {}) {
  const rawDb = useOptionalSQLiteContext();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const onSyncRequiredRef = useRef(onSyncRequired);

  useEffect(() => {
    onSyncRequiredRef.current = onSyncRequired;
  }, [onSyncRequired]);

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
        if (!config?.ip || !config?.port || !config?.token || !isMounted)
          return;

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

            if (parsed.type === "sync_required") {
              onSyncRequiredRef.current?.();
              return;
            }

            if (parsed.type === "anime_deleted") {
              await deleteAnimeLocally(rawDb, parsed.anime_id);
              return;
            }

            // anime_changed y anime_created: fetch snapshot completo desde el bridge
            // Evita aplicar payloads parciales que pueden dejar el registro en estado inconsistente
            await upsertAnimeFromBridge(rawDb, parsed.anime_id);
          } catch (err) {
            console.error("Error processing WS message", err);
          }
        };

        ws.onclose = () => {
          wsRef.current = null;
          if (isMounted && appStateRef.current === "active") {
            scheduleReconnect();
          }
        };

        ws.onerror = () => {
          // onerror generally followed by onclose
        };
      } catch (err) {
        console.error("Error in connect WS:", err);
        if (isMounted && appStateRef.current === "active") {
          scheduleReconnect();
        }
      }
    };

    const scheduleReconnect = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      const backoffSecs = Math.min(
        Math.pow(2, reconnectAttemptRef.current),
        30,
      );
      reconnectAttemptRef.current += 1;

      reconnectTimeoutRef.current = setTimeout(() => {
        if (isMounted && appStateRef.current === "active") {
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
      if (nextAppState === "active") {
        reconnectAttemptRef.current = 0;
        connect();
      } else if (nextAppState === "background") {
        disconnect();
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );

    // Initial connection
    if (appStateRef.current === "active") {
      connect();
    }

    return () => {
      isMounted = false;
      subscription.remove();
      disconnect();
    };
  }, [rawDb]);

  return {};
}
