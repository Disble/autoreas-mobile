# Design: Complete mobile background sync

## Technical Approach

Consolidar el subsistema de sync en un runtime root-level que viva junto al bootstrap de DB, no dentro de una screen. Ese runtime combinará cuatro fuentes de activación: boot con cache local, `AppState=active`, recuperación de red y background task periódico. Todas usarán la misma primitive `syncPendingOperations(rawDb)` para evitar caminos divergentes. Además, persistirá un snapshot observable mínimo para que Settings muestre la salud del background sync sin leer logs.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|---|---|---|---|
| Dueño del sync runtime | Screen-level vs root-level | Root-level | Hoy `useSyncFacade()` queda atado al catálogo; el contrato RFC es app-wide |
| Primitive de catch-up | `incrementalSync()` vs `syncPendingOperations()` | `syncPendingOperations()` | Ya intercambia cambios remotos, confirma outbox y persiste `last_changelog_id` |
| Señal de conectividad | Polling vs `expo-network` listener | `expo-network` | Trigger reactivo y nativo, sin loops manuales |
| Background API | `expo-background-fetch` vs `expo-background-task` | `expo-background-task` | `background-fetch` está deprecado en SDK 55 |
| Acceso DB headless | Context React vs apertura directa | `openAppDatabaseSync()` + `runMigrations()` | Las tasks headless no tienen árbol React ni `SQLiteProvider` |
| Observabilidad | Screen nueva vs sección en Settings | Sección en Settings | Ya existe surface de bridge y evita dispersar estado técnico |

## Data Flow

`AppRootLayout` → `SyncRuntimeGate` → `useSyncFacade()`
`AppState active` / `network regained` / `manual refresh` / `WS sync_required` → `manualSync()`
`manualSync()` → `syncPendingOperations(rawDb)` → SQLite + Bridge + `last_changelog_id`
`runtime result` → persist snapshot local → `SettingsScreen`

`OS BackgroundTask` → `runBackgroundSyncCycle()` → `openAppDatabaseSync()` → `runMigrations()` → `syncPendingOperations(rawDb)`

Foreground rule:
- WS sólo se abre en `active`.
- Resume a foreground dispara reconcile y deja al runtime decidir el socket.

Background rule:
- Task periódico es best-effort; no reemplaza triggers de foreground.
- Si el usuario mata explícitamente la app, dependemos del comportamiento permitido por el OS/Expo.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/features/sync/background-sync.constants.ts` | Create | Nombre de task y defaults de registro |
| `src/features/sync/background-sync.helpers.ts` | Create | Ciclo headless puro/no-op seguro |
| `src/features/sync/background-sync.task.ts` | Create | `TaskManager.defineTask` + register/unregister |
| `src/features/sync/sync-runtime-status.constants.ts` | Create | Claves/valores del snapshot observable |
| `src/features/sync/sync-runtime-status.helpers.ts` | Create | Persistencia del último estado observable del runtime |
| `src/features/sync/use-sync-runtime.ts` | Create | Hook root-level para AppState/red/background registration |
| `src/features/sync/ui/SyncRuntimeGate/*` | Create | Entry feature para montar el runtime sin lógica en `src/app/**` |
| `src/features/sync/use-sync-facade.ts` | Modify | Exponer wiring reusable para runtime global |
| `src/features/ws/use-websocket.ts` | Modify | Coordinar ownership con runtime root, no screen-level |
| `src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts` | Modify | Dejar sólo refresh manual usando el runtime existente |
| `src/features/setup/ui/AppRootLayout/*` | Modify | Montar `SyncRuntimeGate` dentro del shell root |
| `src/features/settings/use-background-sync-status.ts` | Create | Hook para leer snapshot observable desde SQLite |
| `src/features/settings/ui/SettingsScreen/*` | Modify | Mostrar card/sección de estado del background sync |
| `src/infrastructure/db/client.ts` | Modify | Reusar apertura/migración segura para path headless |
| `src/infrastructure/db/schema.ts` | Modify | Tabla singleton liviana para snapshot del runtime/background sync |
| `app.json` | Modify | Plugins/keys de background task |
| `package.json` | Modify | Agregar dependencias Expo necesarias instaladas con Bun |

## Interfaces / Contracts

```ts
export interface SyncRuntimeTrigger {
  readonly source:
    | 'bootstrap'
    | 'manual'
    | 'app_active'
    | 'network_regained'
    | 'ws_sync_required'
    | 'background_task';
}
```

```ts
export interface BackgroundSyncCycleResult {
  readonly kind: 'success' | 'no_op' | 'failed';
  readonly syncedCount: number;
}
```

```ts
export interface SyncRuntimeStatusSnapshot {
  readonly registrationStatus: 'registered' | 'unregistered' | 'unsupported';
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly lastFailureMessage: string | null;
  readonly lastTriggerSource: SyncRuntimeTrigger['source'] | null;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Trigger dedupe, paired/unpaired branching, background no-op/failure | Jest helpers |
| Hook | `use-sync-runtime` reacciona a AppState/red sin duplicar sync | `renderHook` + mocks |
| Integration | Task headless abre DB, corre migrations y llama reconcile | Jest con mocks de DB/task manager |
| UI/Hook | Settings renderiza snapshot de background/runtime status | hook tests + render tests |
| Regression | `AnimeListScreen` ya no monta su propio runtime | Hook tests + grep-safe assertions |

## Migration / Rollout

No migration de datos. Sólo configuración nativa y wiring del runtime.

## Open Questions

- [ ] Ninguna bloqueante; la limitación principal ya conocida es que el background task es best-effort por políticas del OS.
