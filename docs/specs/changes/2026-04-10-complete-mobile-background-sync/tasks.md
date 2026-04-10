# Tasks: Complete mobile background sync

## Phase 1: Native/background foundation

- [ ] 1.1 Red: crear `tests/features/sync/background-sync.helpers.test.ts` para ciclo headless éxito, no-op sin pairing y fallo de red.
- [x] 1.2 Red: crear `tests/features/settings/use-background-sync-status.test.ts` para snapshot vacío, éxito y fallo observable.
- [ ] 1.3 Green: agregar `src/features/sync/background-sync.constants.ts`, `background-sync.helpers.ts`, `sync-runtime-status.constants.ts` y `sync-runtime-status.helpers.ts` reutilizando `openAppDatabaseSync()`, `runMigrations()` y `syncPendingOperations()`.
- [x] 1.4 Green: extender `src/infrastructure/db/schema.ts` y migraciones con una tabla singleton para snapshot observable del runtime/background sync.
- [ ] 1.5 Green: agregar `src/features/sync/background-sync.task.ts` con `TaskManager.defineTask` y helpers `register/unregister` usando `expo-background-task`.
- [ ] 1.6 Green: actualizar `package.json` y `app.json` con `expo-background-task`, `expo-task-manager`, `expo-network` y config nativa requerida, instalando paquetes con `bun add`.

## Phase 2: Root runtime orchestration

- [ ] 2.1 Red: crear `tests/features/sync/use-sync-runtime.test.ts` para boot pareado/no pareado, `AppState active`, reconexión de red y persistencia de snapshot.
- [ ] 2.2 Green: crear `src/features/sync/use-sync-runtime.ts` para coordinar triggers `bootstrap`, `app_active`, `network_regained`, registro del background task y actualización del snapshot observable.
- [ ] 2.3 Green: scaffold con `npm run generate:feature sync-runtime-gate` y adaptar `src/features/sync/ui/SyncRuntimeGate/*` para montar el runtime sin lógica en `src/app/**`.
- [ ] 2.4 Green: montar `SyncRuntimeGate` desde `src/features/setup/ui/AppRootLayout/*` manteniendo `src/app/**` como composición pura.

## Phase 3: Foreground sync ownership

- [ ] 3.1 Red: actualizar `tests/features/ws/use-websocket.test.ts` y `tests/features/sync/use-sync-facade.test.ts` para exigir ownership root-level y dedupe de triggers simultáneos.
- [ ] 3.2 Green: modificar `src/features/sync/use-sync-facade.ts` para exponer wiring reutilizable al runtime global y conservar guard in-flight.
- [ ] 3.3 Green: modificar `src/features/ws/use-websocket.ts` para depender del runtime root, seguir cerrando en `background` y disparar `ws_sync_required` sin screen coupling.
- [ ] 3.4 Refactor: limpiar `src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts` para dejar sólo refresh manual, sin montar su propio runtime.

## Phase 4: Settings observability

- [x] 4.1 Red: crear/actualizar tests de `src/features/settings/ui/SettingsScreen/*` para mostrar registration status, último intento y último error conocido.
- [x] 4.2 Green: crear `src/features/settings/use-background-sync-status.ts` para leer el snapshot observable desde SQLite.
- [x] 4.3 Green: actualizar `src/features/settings/ui/SettingsScreen/*` con una card/sección de estado de background sync junto al bridge actual.

## Phase 5: Verification and regression safety

- [ ] 5.1 Ejecutar Jest sobre `tests/features/sync/*`, `tests/features/ws/*`, `tests/features/settings/*` y `tests/features/animes/use-anime-list-screen.test.ts`.
- [ ] 5.2 Verificar manualmente en Android: foreground resume sync, reconnect de WiFi dispara reconcile, el task queda registrado y Settings refleja el estado observable.
- [ ] 5.3 Verificar caso negativo: sin pairing no se registra task, no abre WS y el outbox permanece intacto ante fallos de red.
