# Tasks: Android foreground sync service

## Phase 1: Capability decision

- [x] 1.1 Instalar `@notifee/react-native` en una Android development build/prebuild y validar compatibilidad con Expo SDK 55.
- [x] 1.2 Declarar permisos y `foregroundServiceType` requeridos para Android 14+ (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `dataSync`) mediante config plugin local.
- [x] 1.3 Subir `compileSdkVersion` a 36 para satisfacer la metadata de AAR requerida por las dependencias Android nuevas.

## Phase 2: Runtime design

- [x] 2.1 Diseñar `SyncExecutionStrategy` como contrato funcional sin clases para los modos `best_effort_background_task` y `android_foreground_service`.
- [x] 2.2 Implementar `createNotifeeForegroundServiceAdapter(deps)` como adapter funcional de infraestructura sobre Notifee.
- [x] 2.3 Implementar `createSyncExecutionFacade(deps)` para selección/fallback funcional entre estrategias.
- [x] 2.4 Persistir `executionMode`, `isForegroundServiceRunning` y `canShowPersistentNotification` en el snapshot SQLite existente.
- [x] 2.5 Implementar un runner funcional del foreground service con ciclo explícito de sync, intervalo controlado y stop idempotente.
- [x] 2.6 Reusar un ciclo headless compartido para `background_task` y `foreground_service`, manteniendo `triggerSource` observable correcto.
- [ ] 2.7 Definir notificación persistente, acciones de stop y fallback a best-effort cuando el servicio no esté activo sobre build Android real.

## Phase 3: Product surface

- [x] 3.1 Extender Settings para distinguir entre `best_effort_background_task` y `android_foreground_service`.
- [ ] 3.2 Documentar copy honesto sobre garantías y limitaciones de cada modo, tratando la notificación persistente como tradeoff normal de sync continuo.

## Phase 4: Native integration planning

- [x] 4.1 Definir cambios en `AndroidManifest.xml`, channel de notificación, permiso `POST_NOTIFICATIONS` y workflow de prebuild/dev build.
- [ ] 4.2 Preparar checklist manual de validación en Android real: app backgrounded, app swiped away, servicio detenido por usuario.
