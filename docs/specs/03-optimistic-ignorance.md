# SDD-03: Optimistic Ignorance y WebSocket Lifecycle

**Estado:** Draft (Pendiente de Revisión Adversarial)
**Track:** Sync (Fase 1)

## 1. Objetivo
Implementar la capa de sincronización en tiempo real vía WebSocket (WS) entre la aplicación React Native y el Bridge en Go. El objetivo principal es recibir actualizaciones del catálogo (ej. cuando se descarga un nuevo capítulo en la PC) **sin sobreescribir mutaciones locales pendientes** (el patrón de "Optimistic Ignorance"). Además, se debe gestionar correctamente el ciclo de vida del WebSocket atado al `AppState` de Android/iOS.

## 2. Flujo de "Optimistic Ignorance" (Resolución por Campo y Batching)

Cuando la PC emite eventos de cambio (`anime_changed`, `anime_created`, `anime_deleted`), se pueden recibir ráfagas. Para evitar N+1 escrituras y bloqueos en la UI:
1. **Buffer/Batching:** Los mensajes entrantes se encolan en memoria. Cada X ms (ej. 500ms) se procesan en lote dentro de una única transacción `withExclusiveTransactionAsync` de SQLite.
2. **Buffer durante Catch-up:** Si el Reconciliador (SDD-04) está ejecutando un "Catch-up" HTTP, los eventos del WS se encolan hasta que termine, para evitar condiciones de carrera entre la respuesta HTTP y el WS.

### 2.1 La Transacción de Fusión (Merge)

**Problema Histórico:** Descartar el evento completo si el `updated_at` local es mayor (por una mutación reciente) destruye actualizaciones ortogonales (ej. el usuario cambia `nrocapvisto` offline, la PC actualiza `totalcap`; descartar el evento borra la descarga del nuevo capítulo).
**Problema de Relojes:** No se puede confiar en timestamps absolutos (`updated_at`) por el "time drift" entre PC y móvil. El Bridge debe enviar un `version` (secuencia incremental) o el móvil debe asumir la PC como fuente de verdad absoluta para los campos no mutados.

**Solución Atómica (Por Campo):**
El payload del `operation_log` guarda un JSON con los campos mutados. La query de SQLite usará `json_extract` para saber si un campo específico está "pending" de sincronización.

```sql
UPDATE animes 
SET 
  -- totalcap viene de la PC. Si el usuario NO lo mutó localmente (no está en el JSON pending), lo pisamos con el de la PC.
  totalcap = CASE 
    WHEN json_extract((SELECT payload FROM operation_log WHERE record_id = ? AND status = 'pending'), '$.totalcap') IS NOT NULL 
    THEN totalcap -- Retenemos el valor local porque hay una mutación pending
    ELSE ? -- Valor del WS
  END,
  
  -- Lo mismo para nrocapvisto
  nrocapvisto = CASE 
    WHEN json_extract((SELECT payload FROM operation_log WHERE record_id = ? AND status = 'pending'), '$.nrocapvisto') IS NOT NULL 
    THEN nrocapvisto 
    ELSE ? 
  END
WHERE id = ?;
```
*(Nota: En Drizzle, esto se implementa con `sql\`...\` helper para la lógica del CASE WHEN).*

## 3. Manejo del Ciclo de Vida del WebSocket (AppState y Red)

- Utilizar `AppState` de React Native.
- **`background`:** Cerrar explícitamente la conexión WS. (Nota: NO cerrar en `inactive`, ya que en iOS salta al bajar el centro de notificaciones).
- **`active`:** Establecer la conexión WS con una estrategia de **Exponential Backoff** si falla.
- **Reconexión / Delta Sync:** Al reconectar, NO hacer un re-fetch global. El Reconciliador (SDD-04) debe encargarse de hacer un "Catch-up" pidiendo solo los cambios desde el último `last_sync_version`.

## 4. Estructura de Datos (Zod) y Resiliencia

Los payloads del WS deben ser validados de manera segura (`safeParse`). El runtime actual usa una **unión discriminada por `type`**, no un objeto plano con campos opcionales compartidos:
```typescript
const AnimeChangedEventSchema = z.object({
  type: z.literal('anime_changed'),
  anime_id: z.string(),
});

const AnimeCreatedEventSchema = z.object({
  type: z.literal('anime_created'),
  anime_id: z.string(),
});

const AnimeDeletedEventSchema = z.object({
  type: z.literal('anime_deleted'),
  anime_id: z.string(),
});

const SyncRequiredEventSchema = z.object({
  type: z.literal('sync_required'),
});

const PreferencesChangedEventSchema = z.object({
  type: z.literal('preferences_changed'),
  season_mode: z.boolean(),
});

const SeasonChangedEventSchema = z.object({
  type: z.literal('season_changed'),
});

const WSEventSchema = z.union([
  AnimeChangedEventSchema,
  AnimeCreatedEventSchema,
  AnimeDeletedEventSchema,
  SyncRequiredEventSchema,
  PreferencesChangedEventSchema,
  SeasonChangedEventSchema,
]);
```
- `anime_changed`, `anime_created` y `anime_deleted` **requieren** `anime_id`.
- `preferences_changed` **requiere** `season_mode`.
- `sync_required` y `season_changed` no cargan `anime_id` en el contrato actual.
Si `safeParse` falla, loguear el error y descartar el mensaje. Si los fallos superan un umbral (ej. 5 seguidos), desconectar el WS y forzar un Reconciliador "Catch-up" completo asumiendo corrupción de estado.

## 5. Criterios de Éxito (Simulación)
1. Llega evento WS de `anime_id = 10` indicando `anime_changed`.
2. Se detecta en `operation_log` que `anime_id = 10` tiene un `pending` (ej. el usuario había marcado `nrocapvisto = 5` estando offline/desconectado).
3. El evento del WS dispara reconciliación, y la aplicación local del cambio remoto se droppea silenciosamente mientras exista ese `pending`.
4. La UI mantiene `nrocapvisto = 5`.
5. Minimizar la app cierra el WS. Volver a abrirla lo reconecta.
