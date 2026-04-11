# Tasks: Android foreground sync service

## Phase 1: Capability decision

- [ ] 1.1 Instalar `@notifee/react-native` en una Android development build/prebuild y validar compatibilidad con Expo SDK 55.
- [ ] 1.2 Declarar permisos y `foregroundServiceType` requeridos para Android 14+ (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `dataSync`).

## Phase 2: Runtime design

- [ ] 2.1 Diseñar wrapper `android-foreground-sync` sobre `notifee.registerForegroundService(...)`, reutilizando `syncPendingOperations()` y snapshot SQLite existente.
- [ ] 2.2 Definir notificación persistente, acciones de stop y fallback a best-effort cuando el servicio no esté activo.

## Phase 3: Product surface

- [ ] 3.1 Extender Settings para distinguir entre `best_effort_background_task` y `android_foreground_service`.
- [ ] 3.2 Documentar copy honesto sobre garantías y limitaciones de cada modo, tratando la notificación persistente como tradeoff normal de sync continuo.

## Phase 4: Native integration planning

- [ ] 4.1 Definir cambios en `AndroidManifest.xml`, channel de notificación, permiso `POST_NOTIFICATIONS` y workflow de prebuild/dev build.
- [ ] 4.2 Preparar checklist manual de validación en Android real: app backgrounded, app swiped away, servicio detenido por usuario.
