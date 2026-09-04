import { createBridgeClient } from './bridge-client.helpers';
import type { BridgeClient } from './bridge-client.types';

/**
 * Shared bridge client instance used across the app; backed by the global `fetch`/`WebSocket`.
 *
 * It lives in its own constants module rather than in `bridge-client.constants.ts` to avoid a
 * cycle: the helpers import that file for `BRIDGE_API_PATHS`, so a singleton declared there would
 * evaluate `createBridgeClient` before the helpers module finished initializing.
 */
export const bridgeClient: BridgeClient = createBridgeClient();
