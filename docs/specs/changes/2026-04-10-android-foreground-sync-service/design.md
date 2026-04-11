# Design: Android foreground sync service

## Technical Approach

Agregar un segundo modo de ejecución para Android: foreground service con notificación persistente. El reconciler y snapshot SQLite NO cambian; cambia sólo la garantía operacional y el runtime nativo que mantiene el proceso elegible fuera del lifecycle normal.

La notificación persistente se considera un tradeoff aceptable y normal para este modo, similar a herramientas de sincronización continua. El costo principal no es visual sino de integración nativa, permisos/manifest y lifecycle management.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|---|---|---|---|
| Garantía fuerte Android | WorkManager only vs foreground service | Foreground service | WorkManager no garantiza continuidad tras kill manual |
| Librería nativa | `react-native-background-actions` vs `@notifee/react-native` | `@notifee/react-native` | Tiene soporte fuerte para foreground service + notificación persistente, mejor story con Expo prebuild/dev build y menos riesgo de hacks auxiliares |
| Soporte de plataforma | Android+iOS vs Android-only | Android-only | iOS no tiene equivalente UX/directo para este caso |
| Reconciler | Nuevo algoritmo vs reusar actual | Reusar `syncPendingOperations()` | Menor riesgo y misma semántica de datos |

## Data Flow

`Settings` → enable continuous sync → Android foreground service starts → persistent notification alive → loop/trigger invokes `syncPendingOperations()` → SQLite snapshot updates → `Settings`

Fallback:
- Si foreground service no está disponible, mantener `expo-background-task` best-effort.

Native execution sketch:
- `notifee.registerForegroundService(...)`
- `notifee.displayNotification({ android: { asForegroundService: true, foregroundServiceTypes: ['dataSync'] } })`
- Loop/control logic reusa el runtime actual y persiste snapshot SQLite

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/features/sync/android-foreground-sync.*` | Create | Runtime específico de foreground service |
| `src/features/settings/*` | Modify | Toggle/mode visibility and stronger guarantee copy |
| `android/app/src/main/AndroidManifest.xml` | Modify | Service + permissions |
| `app.json` / plugins | Modify | Prebuild/native integration con Notifee |
| `docs/*` | Modify | Tradeoffs and support matrix |

## Interfaces / Contracts

```ts
export type SyncExecutionMode = 'best_effort_background_task' | 'android_foreground_service';
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Mode selection/copy | Jest |
| Integration | Service start/stop wrappers | Native mocks |
| Manual Android | Notification persistence, stop action, kill behavior | Device validation |

## Migration / Rollout

Requiere salir de Expo Go y usar development build/prebuild. La recomendación es mantener el proyecto en Expo con config plugins, no saltar a bare salvo que Notifee/plugin quede corto.

Rollout sugerido:
- Paso 1: validar la integración en Android dev build.
- Paso 2: exponer el modo como feature flag o toggle interno.
- Paso 3: recién después decidir si queda user-facing en Settings.

## Open Questions

- [ ] ¿Queremos toggle user-facing o modo siempre-on para Android?
- [ ] ¿Qué copy exacto tendrá la notificación persistente y la acción de stop?
