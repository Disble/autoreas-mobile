# Design: Android foreground sync service

## Technical Approach

Agregar un segundo modo de ejecución para Android: foreground service con notificación persistente. El reconciler y snapshot SQLite NO cambian; cambia sólo la garantía operacional y el runtime nativo que mantiene el proceso elegible fuera del lifecycle normal.

Los patrones se implementarán en estilo funcional, sin clases: contratos por tipos, estrategias como módulos/funciones, adapters de infraestructura como funciones puras + closures, y una facade funcional para el runtime de aplicación.

La notificación persistente se considera un tradeoff aceptable y normal para este modo, similar a herramientas de sincronización continua. El costo principal no es visual sino de integración nativa, permisos/manifest y lifecycle management.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|---|---|---|---|
| Garantía fuerte Android | WorkManager only vs foreground service | Foreground service | WorkManager no garantiza continuidad tras kill manual |
| Librería nativa | `react-native-background-actions` vs `@notifee/react-native` | `@notifee/react-native` | Tiene soporte fuerte para foreground service + notificación persistente, mejor story con Expo prebuild/dev build y menos riesgo de hacks auxiliares |
| Soporte de plataforma | Android+iOS vs Android-only | Android-only | iOS no tiene equivalente UX/directo para este caso |
| Reconciler | Nuevo algoritmo vs reusar actual | Reusar `syncPendingOperations()` | Menor riesgo y misma semántica de datos |
| Estilo de patrones | Clases OOP vs diseño funcional | Diseño funcional | El proyecto prefiere contratos por tipos, módulos y closures en lugar de clases |

## Data Flow

`Settings` → enable continuous sync → Android foreground service starts → persistent notification alive → loop/trigger invokes `syncPendingOperations()` → SQLite snapshot updates → `Settings`

Fallback:
- Si foreground service no está disponible, mantener `expo-background-task` best-effort.

Native execution sketch:
- `createNotifeeForegroundServiceAdapter(deps)` adapta la API nativa de Notifee
- `createForegroundSyncRunner(deps)` mantiene el loop/intervalo del trabajo continuo y su cancelación explícita
- `runHeadlessSyncCycle(deps)` centraliza el reconcile headless y la persistencia observable para `background_task` y `foreground_service`
- `createAndroidForegroundServiceStrategy(deps)` decide registro/start/stop/status del modo continuo
- `createSyncExecutionFacade(deps)` expone la interfaz estable consumida por el runtime de sync
- Loop/control logic reusa el runtime actual y persiste snapshot SQLite

Estado actual de implementación:
- `createNotifeeForegroundServiceAdapter()` ya quedó implementado como adapter funcional sobre Notifee.
- `createForegroundSyncRunner()` ahora gobierna un loop explícito con ejecución inmediata, intervalo fijo y stop idempotente.
- `runHeadlessSyncCycle()` ahora evita duplicar lógica entre `expo-background-task` y el foreground service Android, preservando un `triggerSource` honesto (`background_task` vs `foreground_service`).
- `createSyncExecutionFacade()` ya selecciona estrategia preferida y fallback funcional.
- El runtime root-level ya persiste `executionMode`, `isForegroundServiceRunning` y `canShowPersistentNotification` en `sync_runtime_status`.
- Settings ya puede reflejar modo best-effort vs foreground service desde el snapshot persistido.
- `withAndroidForegroundSync` ya declara `app.notifee.core.ForegroundService` como `dataSync` y agrega permisos Android relevantes vía config plugin local.
- La build Android necesita `compileSdkVersion` 36 porque las dependencias transitivas nuevas (`androidx.browser:browser:1.9.0`, `androidx.core:core-ktx:1.17.0`) ya no compilan contra 35.
- Las instalaciones existentes pueden requerir un path defensivo de reparación de columnas para `sync_runtime_status` si la tabla fue creada antes de la migración `0003` o si la app intenta tocar el snapshot antes de que el journal quede consistente en el dispositivo.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/features/sync/android-foreground-sync.*` | Create | Runtime específico de foreground service |
| `src/features/sync/sync-execution-strategy.*` | Create | Contrato funcional para estrategias de ejecución |
| `src/features/sync/notifee-foreground-service-adapter.*` | Create | Adapter funcional de infraestructura para Notifee |
| `src/features/sync/sync-execution-facade.*` | Create | Facade funcional para seleccionar/fallback de estrategia |
| `src/features/settings/*` | Modify | Toggle/mode visibility and stronger guarantee copy |
| `android/app/src/main/AndroidManifest.xml` | Modify | Service + permissions |
| `app.json` / plugins | Modify | Prebuild/native integration con Notifee |
| `docs/*` | Modify | Tradeoffs and support matrix |

## Interfaces / Contracts

```ts
export type SyncExecutionMode = 'best_effort_background_task' | 'android_foreground_service';

export interface SyncExecutionStrategy {
  readonly mode: SyncExecutionMode;
  readonly register: () => Promise<void>;
  readonly unregister: () => Promise<void>;
  readonly getStatus: () => Promise<{
    readonly registrationStatus: 'registered' | 'unregistered' | 'unsupported';
    readonly isForegroundServiceRunning: boolean;
    readonly canShowPersistentNotification: boolean;
  }>;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Mode selection/copy | Jest |
| Integration | Service start/stop wrappers | Native mocks |
| Manual Android | Notification persistence, stop action, kill behavior | Device validation |

## Migration / Rollout

Requiere salir de Expo Go y usar development build/prebuild. La recomendación es mantener el proyecto en Expo con config plugins, no saltar a bare salvo que Notifee/plugin quede corto.

Importante: los cambios de `foregroundServiceType` y permisos NO impactan un binario ya compilado. Después de cambiar `app.json`/config plugin hay que regenerar el nativo (`prebuild`/new dev build) para que el manifest real deje de crashear por mismatch.

Importante 2: después de integrar Notifee y sus dependencias transitivas, el Android build debe recompilar con `compileSdkVersion` 36 o mayor. Si el entorno sigue usando 35, Gradle falla en `:app:checkDebugAarMetadata` antes de llegar al runtime.

Rollout sugerido:
- Paso 1: validar la integración en Android dev build.
- Paso 2: exponer el modo como feature flag o toggle interno.
- Paso 3: recién después decidir si queda user-facing en Settings.

## Open Questions

- [ ] ¿Queremos toggle user-facing o modo siempre-on para Android?
- [ ] ¿Qué copy exacto tendrá la notificación persistente y la acción de stop?
