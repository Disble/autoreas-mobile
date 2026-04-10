# ADR 006: Offline-First Local Boot and Functional Sync Patterns

## Status
Accepted

## Context
The mobile RFC/design doc requires the app to be usable from the first second with local SQLite data, without blocking startup on the Bridge. The current implementation violated that contract by awaiting `initialSync()` during bootstrap before rendering any route, effectively making startup network-first. We also need a functional-pattern vocabulary that fits React hooks without drifting into pseudo-OOP.

## Decision
We enforce an **offline-first startup architecture** with these functional design patterns:

1. **Facade Pattern → `useSyncFacade()` custom hook**
   - The hook is the simplified client interface to the sync subsystem.
   - UI and feature hooks must consume `manualSync`, `connectionStatus`, `pendingOpsCount`, `lastSyncAt`, and `syncError` from the facade instead of coordinating reconcile/websocket/bootstrap internals directly.

2. **Strategy Pattern → interchangeable sync functions with one stable contract**
   - `SyncBootstrapStrategy = (context) => Promise<number>` is the strategy contract.
   - `runHydrationBootstrapStrategy` and `runReconcileBootstrapStrategy` are the concrete strategies.
   - The selector that chooses which strategy to use is NOT the strategy itself; it only resolves the proper implementation from local-cache state.

3. **Adapter Pattern → contract translation at the boundary**
   - `adaptAsyncSyncToVoidHandler` adapts the async facade sync contract `() => Promise<number>` to the void callback contract expected by the WebSocket hook.
   - Adapters are defined by the contract they receive and the contract they translate into, not by the shape of their returned object alone.

4. **Explicit State Pattern → discriminated union + pure transition function**
   - Sync runtime status is modeled as a discriminated union (`idle | syncing | online | offline | error`).
   - `transitionSyncState` is the only place that moves sync state from one status to another.

5. **Bootloader Rule**
   - `useDbBootstrap()` is local-only: WAL, migrations, local bridge config lookup, route selection.
   - Startup must never await Bridge sync.

6. **Pairing Hydration Rule**
   - Initial cache hydration belongs to the pairing flow, not to recurring app boot.
   - After saving bridge credentials, pairing performs `initialSync()` to seed SQLite.

## Consequences
### Positive
- Startup stays aligned with the RFC: local-first, bridge-optional.
- Sync behavior is centralized behind one React-native-friendly facade.
- Pattern intent is explicit and documented in functional terms.
- Manual refresh, websocket-triggered sync, and bootstrap sync all reuse the same facade contract.

### Negative
- Sync responsibilities move toward a more centralized subsystem, which requires discipline to avoid turning the facade into a god hook.
- Pairing now owns the first hydration path, so pairing tests and error handling become more important.
