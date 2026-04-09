# Autoreas Mobile — Gaps del Bridge

**Fecha:** 2026-04-08  
**Autor:** Análisis contra `openapi.yaml` + `referencia_autoreas-bridge-rfc.md` + código fuente de la app  
**Estado:** Activo — actualizar a medida que el bridge implemente cada ítem

---

## Resumen ejecutivo

El bridge actual (`openapi.yaml`) implementa **3 de los ~15 endpoints** definidos en el RFC/Design Doc, y el contrato de los endpoints existentes diverge del diseño en puntos críticos. La app mobile tiene la lógica completa del lado cliente, pero **no puede funcionar end-to-end** porque le faltan los canales de entrada de datos desde el bridge.

El bug inmediato: la SQLite local de la app nunca se puebla. No existe ningún endpoint de listado ni mecanismo de sync inicial.

---

## 1. Endpoint crítico faltante — Initial sync (BLOQUEANTE)

### `GET /api/animes`

**Estado en bridge:** ❌ No implementado  
**Estado en app:** Implementación lista para recibirlo, no tiene de donde llamarlo  

Este es el bug que produce la pantalla vacía. Sin este endpoint, la SQLite local de la app nunca tiene datos. La app es 100% offline-first: lee de SQLite local y muta localmente. Pero ese local store necesita un estado inicial que venga del bridge.

**Shape esperado por la app (basado en `AnimeSchema` de Zod):**

```json
[
  {
    "_id": "string (16 chars)",
    "nombre": "string",
    "estado": 0,
    "nrocapvisto": 0,
    "totalcap": null,
    "activo": 1,
    "primeravez": 1,
    "dias": [{ "dia": "Miércoles", "orden": 1 }],
    "generos": ["Acción"],
    "tipo": null,
    "fechaUltCapVisto": 1523077932046,
    "fechaEstreno": null,
    "fechaCreacion": 1523077932046,
    "fechaEliminacion": null,
    "portada": "string | null",
    "pagina": "string | null",
    "carpeta": "string | null",
    "estudios": "string | null",
    "origen": "string | null",
    "duracion": null
  }
]
```

**Reglas de serialización que la app ya soporta (vía `AnimeSchema` Zod):**

- Fechas: `{"$$date": 1523077932046}` → se coerciona a número. El bridge puede enviar timestamp directo (number) o formato `$$date` — ambos funcionan.
- `activo` / `primeravez`: el RFC los define como `boolean` en `animes.dat`, pero la app los guarda y espera como `integer` (0/1). El bridge DEBE serializar como `0`/`1`, no `true`/`false`.
- `dias`: array de `{dia: string, orden: number}`. Arrays vacíos como `""` también son aceptados (Zod los coerciona).
- `generos`: array de strings. Mismo manejo que `dias`.
- `estado`: `0` = viendo, `1` = completado, `2` = mirando de nuevo, `3` = dropeado.
- Solo se muestran en la tab "Viendo": `activo = 1 AND estado = 0`.

**Qué hace la app con los datos:**  
`INSERT OR REPLACE INTO animes` en SQLite local. Toda la lista al primer boot post-pairing.

**Autenticación requerida:** Sí — `Authorization: Bearer <auth_token>`

---

## 2. Endpoint faltante — Fetch por ID (necesario para sync en tiempo real)

### `GET /api/animes/:id`

**Estado en bridge:** ❌ No implementado  
**Estado en app:** `use-websocket.ts` recibe evento `anime_changed` y actualmente intenta hacer `UPDATE` directo con el payload del WS. Si el registro no existe localmente (primera conexión o registro nuevo), el UPDATE silenciosamente no hace nada.

El diseño correcto según el RFC es:
1. Bridge emite `anime:changed` por WS con el `anime_id`
2. App hace `GET /api/animes/:id` para obtener el snapshot completo
3. App hace `INSERT OR REPLACE` con ese snapshot

Sin este endpoint, el WS `anime_changed` no puede usarse para sincronizar registros nuevos ni para hacer un initial state por registro.

**Shape esperado:** Mismo objeto individual que el ítem del array de `GET /api/animes`.

**Autenticación requerida:** Sí — `Authorization: Bearer <auth_token>`

---

## 3. Endpoint faltante — Changelog incremental

### `GET /api/animes/changes?since=<timestamp>`

**Estado en bridge:** ❌ No implementado  
**Estado en app:** No implementado (dependencia directa de este endpoint)

Necesario para el caso de reconexión offline → online. Si la app estuvo offline y el usuario hizo cambios en Autoreas Desktop, la app necesita saber qué cambió desde el último sync para hacer un update incremental sin re-descargar todo.

**Shape esperado:**

```json
{
  "changes": [
    {
      "record_id": "string",
      "change_type": "update | create | delete",
      "changed_fields": ["nrocapvisto", "fechaUltCapVisto"],
      "snapshot": { /* objeto Anime completo */ },
      "timestamp": 1523077932046
    }
  ],
  "last_changelog_id": 42
}
```

**Autenticación requerida:** Sí — `Authorization: Bearer <auth_token>`

---

## 4. Contrato roto — `POST /api/sync/reconcile`

**Estado en bridge:** ✅ Existe pero el contrato está incompleto  

El bridge acepta `POST /api/sync/reconcile` y responde `202 Accepted`. Pero según el RFC, este endpoint debería ser **bidireccional**: la app envía su `operation_log` pendiente Y el bridge responde con su changelog pendiente para la app.

**Lo que la app hace hoy:** `use-reconcile.ts` itera el `operation_log` y hace un `PATCH /api/animes/:id` por cada entrada pendiente. No usa `POST /api/sync/reconcile` para el intercambio de changelogs.

**Lo que falta en el contrato del bridge:**

Request body esperado (que la app debería enviar):
```json
{
  "device_id": "string",
  "last_changelog_id": 0,
  "pending_operations": [
    {
      "anime_id": "string",
      "operation": "cap_plus | cap_minus | estado_change",
      "payload": { "nrocapvisto": 5 },
      "created_at": 1523077932046
    }
  ]
}
```

Response esperada (que el bridge debería devolver):
```json
{
  "status": "accepted",
  "bridge_changes": [
    /* changelog del bridge desde last_changelog_id */
  ],
  "conflicts": []
}
```

**Decisión pendiente:** ¿Se mantiene el modelo actual (PATCH individual por operación) o se migra al modelo de intercambio de changelogs del RFC? Ambos enfoques son válidos pero deben elegirse uno.

---

## 5. Contrato roto — Eventos WebSocket

**Estado en bridge:** ✅ WS existe pero los nombres de eventos divergen  

| Evento según RFC/Design Doc | Evento actual en bridge (`openapi.yaml`) | Estado en app |
|-----------------------------|------------------------------------------|---------------|
| `anime:changed` | `anime_changed` (guión bajo) | ⚠️ App usa `anime_changed` — coincide con el bridge actual, diverge del RFC |
| `anime:created` | No documentado | ❌ App no lo maneja |
| `anime:deleted` | No documentado | ❌ App no lo maneja |
| `sync:conflict` | No documentado | ❌ App no lo maneja |
| `sync_required` | `sync_required` | ✅ Coincide |

**Problema crítico en el evento `anime_changed`:**  
El bridge envía:
```json
{ "type": "anime_changed", "anime_id": "...", "payload": { "estado": 0, "nrocapvisto": 4, "dias": "..." } }
```
La app aplica ese payload directamente como `UPDATE SET` en SQLite. Esto solo funciona si el registro ya existe localmente. Si no existe (primer boot), el UPDATE no hace nada y el anime no aparece.

**Problema de serialización de `dias` en el evento WS:**  
El schema del WS (`AnimeChangedEventSchema` en `use-websocket.ts`) define `dias` como `z.string().optional()`, pero en SQLite se guarda como string JSON serializado. Si el bridge envía `dias` como array en el payload del WS, el UPDATE fallará silenciosamente por tipo incorrecto.

---

## 6. Endpoints faltantes — Dispositivos

### `GET /api/devices`
### `DELETE /api/devices/:id`

**Estado en bridge:** ❌ No implementados  
**Estado en app:** No implementados (son funciones del bridge UI, no de la app mobile directamente)

Necesarios para:
- Que el bridge UI muestre dispositivos conectados
- Revocar acceso desde el bridge
- Re-pairing si el token cambia

---

## 7. Endpoints faltantes — Estado y conflictos

### `GET /api/status`
### `GET /api/conflicts`
### `POST /api/conflicts/:id/resolve`

**Estado en bridge:** ❌ No implementados  
**Estado en app:** No implementados

`GET /api/status` es el más relevante para la app: la app podría mostrarlo para debug (¿está el bridge online?, ¿cuándo fue el último sync?).

---

## 8. Divergencia de tipos — `activo` y `primeravez`

**Crítico para la serialización**

En `animes.dat` (fuente de verdad del bridge), `activo` y `primeravez` son `boolean`.  
En la SQLite de la app, son `integer` (`0`/`1`).

El bridge DEBE serializar estos campos como `0`/`1` en todas las respuestas REST y eventos WS. Si el bridge los envía como `true`/`false`, el `AnimeSchema` Zod de la app los rechazará (no hay coerción de boolean→integer en el schema actual).

**Campos afectados:** `activo`, `primeravez`

---

## 9. Divergencia de tipos — `portada`

En `animes.dat`, `portada` tiene la forma:
```json
{ "type": "string", "path": "string" }
```

En el schema de la app (`anime-schema.ts`), `portada` está definido como `z.string().nullable().optional()`.

Si el bridge serializa `portada` como objeto, Zod lo rechazará y el anime completo fallará la validación. El bridge debe serializar `portada` como string (la ruta o URL de la imagen) o como `null`.

---

## 10. Campo faltante en `PATCH /api/animes/:id`

La app envía en `operation_log` payloads con `fechaUltCapVisto` (timestamp Unix ms). El endpoint `PATCH /api/animes/:id` actual en `openapi.yaml` no documenta `fechaUltCapVisto` como campo aceptado.

Según el RFC/Design Doc, `fechaUltCapVisto` SÍ está en la lista de campos patcheables.

**Impacto:** Cada `cap_plus` genera una operación con `{ nrocapvisto: N }` en el payload (el `fechaUltCapVisto` se guarda solo en la SQLite local, no se manda al bridge hoy). Pero si en el futuro se quiere sync bidireccional de esta fecha, el bridge necesita aceptarla.

**Verificar:** ¿El bridge silencia campos desconocidos o retorna 400? Según el openapi.yaml actual: *"unknown fields are silently ignored"* — OK por ahora.

---

## Resumen de prioridades

| # | Gap | Impacto | Prioridad |
|---|-----|---------|-----------|
| 1 | `GET /api/animes` | 🔴 BLOQUEANTE — pantalla vacía | P0 |
| 2 | `activo`/`primeravez` como 0/1 (no boolean) | 🔴 BLOQUEANTE — parse falla | P0 |
| 3 | `portada` como string (no objeto) | 🔴 BLOQUEANTE — parse falla si tiene portada | P0 |
| 4 | `GET /api/animes/:id` | 🟠 CRÍTICO — WS sync incompleto para registros nuevos | P1 |
| 5 | Evento WS `anime:created` | 🟠 CRÍTICO — animes nuevos nunca llegan a la app | P1 |
| 6 | Evento WS `anime:deleted` | 🟠 CRÍTICO — borrados nunca se reflejan en la app | P1 |
| 7 | `GET /api/animes/changes?since=` | 🟡 IMPORTANTE — sync incremental en reconexión | P2 |
| 8 | Contrato bidireccional de `POST /api/sync/reconcile` | 🟡 IMPORTANTE — reconciliación real al reconectar | P2 |
| 9 | `GET /api/status` | 🟢 NICE TO HAVE — debug y diagnóstico | P3 |
| 10 | `GET /api/devices` + `DELETE /api/devices/:id` | 🟢 NICE TO HAVE — gestión desde bridge UI | P3 |
| 11 | `GET /api/conflicts` + `POST /api/conflicts/:id/resolve` | 🟢 NICE TO HAVE — resolución manual de conflictos | P3 |

---

## Flujo completo esperado post-fix

```
1. BOOT (primera vez post-pairing)
   └── GET /api/animes → INSERT OR REPLACE INTO animes (todos)

2. BOOT (reconexiones subsiguientes)
   └── GET /api/animes/changes?since=<last_sync_ts>
       └── INSERT OR REPLACE INTO animes (solo los cambiados)

3. EN TIEMPO REAL (WS conectado)
   ├── evento anime_changed  → GET /api/animes/:id → UPDATE local
   ├── evento anime:created  → GET /api/animes/:id → INSERT local
   ├── evento anime:deleted  → DELETE FROM animes WHERE _id = ?
   └── evento sync_required  → ejecutar flujo de reconexión (paso 2)

4. MUTACIÓN LOCAL (usuario toca Cap+/Cap-)
   ├── UPDATE local SQLite (inmediato, offline-first)
   ├── INSERT operation_log (status: pending)
   └── PATCH /api/animes/:id (en background via use-reconcile)
       └── si 200 OK → UPDATE operation_log SET status = 'synced'
```
