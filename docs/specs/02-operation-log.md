# SDD-02: Operation Log y Drizzle ORM

## Exploration: Operation Log transaccional para Cap+

### Current State
- El repo todavía no tiene implementación real de `expo-sqlite` ni `drizzle-orm`; hoy este tema existe a nivel de arquitectura y specs.
- `docs/specs/01-foundation.md` ya fija dos restricciones NO negociables: `nrocapvisto` debe persistirse como `REAL` y las mutaciones críticas deben correr con `withExclusiveTransactionAsync()`.
- `ARCHITECTURE.md` define el patrón **Optimistic Ignorance**: toda mutación local escribe `animes` + `operation_log`, y cualquier evento remoto se ignora si existe un `pending` para ese anime.

### Affected Areas
- `docs/specs/01-foundation.md` — base técnica de SQLite/Drizzle, coerción legacy y transacciones exclusivas.
- `ARCHITECTURE.md` — contrato arquitectónico de SSOT + optimistic ignorance.
- `docs/Autoreas_mobile_design_doc.md` — modelo de datos local y comportamiento esperado de `Cap+`.
- `src/infrastructure/db/schema.ts` — futuro schema Drizzle real.
- `src/infrastructure/db/client.ts` — apertura `openDatabaseSync(..., { enableChangeListener: true })` y `drizzle(...)`.
- `src/features/animes/repositories/*` — mutación `Cap+` y consultas de `pending`.

### Approaches
1. **Operation log campo-a-campo** — una fila por campo modificado (`nrocapvisto`, `estado`, `primeravez`, etc.).
   - Pros: fácil de inspeccionar manualmente; se parece al borrador actual del design doc.
   - Cons: un solo `Cap+` puede generar 2-4 filas; complica idempotencia y reconciliación; hace más difícil reconstruir la intención del usuario.
   - Effort: Medium.

2. **Operation log por intención (patch agrupado)** — una fila `pending` por mutación local, con un `payload` JSON que contiene todos los campos cambiados.
   - Pros: modela mejor `Cap+`; simplifica replay/reconcile; mantiene atomicidad lógica; tolera auto-finalización y reglas de estrenos sin fragmentar el evento.
   - Cons: el payload JSON requiere validación fuerte; inspección SQL manual menos trivial.
   - Effort: Medium.

### Recommendation
Usar **operation log por intención (patch agrupado)**. Acá está la clave, hermano: el usuario no piensa “cambié tres columnas”; piensa “hice un Cap+”. Si la capa de datos rompe esa intención en múltiples filas, te metés solo en problemas de sincronización, orden y reintentos. Para mobile offline-first conviene registrar una sola operación lógica con `payload` JSON y `status = 'pending'`.

---

## 1. Schema exacto recomendado en Drizzle

```ts
import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const animeEstados = ['viendo', 'finalizado', 'no_me_gusto', 'en_pausa'] as const;
export type AnimeEstado = 0 | 1 | 2 | 3;

export const operationStatuses = ['pending', 'synced', 'failed', 'conflict'] as const;
export type OperationStatus = (typeof operationStatuses)[number];

export const operationTypes = ['anime_patch'] as const;
export type OperationType = (typeof operationTypes)[number];

export const diasPermitidos = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
  'Sin ver',
  'Ver hoy',
  'Visto',
] as const;

export type DiaNombre = (typeof diasPermitidos)[number];

export type DiaItem = {
  dia: DiaNombre;
  orden: number;
};

export type AnimePatch = Partial<{
  nrocapvisto: number;
  estado: AnimeEstado;
  dias: DiaItem[];
  primeravez: boolean;
  fechaEstreno: number | null;
  fechaUltCap: number | null;
  updatedAt: number;
}>;

const normalizeDias = (value: unknown): DiaItem[] => {
  if (value == null || value === '') return [];

  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) return [];

  return parsed.map((item) => ({
    dia: item.dia,
    orden: Number(item.orden),
  }));
};

const diasJson = customType<{ data: DiaItem[]; driverData: string }>({
  dataType() {
    return 'text';
  },
  toDriver(value) {
    return JSON.stringify(normalizeDias(value));
  },
  fromDriver(value) {
    return normalizeDias(value);
  },
});

const jsonText = <T>() =>
  customType<{ data: T; driverData: string }>({
    dataType() {
      return 'text';
    },
    toDriver(value) {
      return JSON.stringify(value);
    },
    fromDriver(value) {
      return JSON.parse(value) as T;
    },
  });

export const animes = sqliteTable(
  'animes',
  {
    id: text('_id').primaryKey(),
    nombre: text('nombre').notNull(),
    nrocapvisto: real('nrocapvisto').notNull(),
    totalcap: integer('totalcap', { mode: 'number' }),
    estado: integer('estado', { mode: 'number' }).$type<AnimeEstado>().notNull(),
    dias: diasJson('dias').notNull(),
    activo: integer('activo', { mode: 'boolean' }).notNull(),
    primeravez: integer('primeravez', { mode: 'boolean' }).notNull(),
    fechaUltCap: integer('fecha_ult_cap', { mode: 'number' }),
    fechaEstreno: integer('fecha_estreno', { mode: 'number' }),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    estadoActivoIdx: index('animes_estado_activo_idx').on(table.estado, table.activo),
    updatedAtIdx: index('animes_updated_at_idx').on(table.updatedAt),
  }),
);

export const operationLog = sqliteTable(
  'operation_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entity: text('entity', { enum: ['anime'] }).notNull().default('anime'),
    recordId: text('record_id').notNull(),
    operationType: text('operation_type', { enum: operationTypes }).notNull(),
    payload: jsonText<AnimePatch>()('payload').notNull(),
    status: text('status', { enum: operationStatuses }).notNull().default('pending'),
    retryCount: integer('retry_count', { mode: 'number' }).notNull().default(0),
    errorMessage: text('error_message'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    syncedAt: integer('synced_at', { mode: 'number' }),
  },
  (table) => ({
    statusCreatedAtIdx: index('operation_log_status_created_at_idx').on(table.status, table.createdAt),
    recordStatusIdx: index('operation_log_record_id_status_idx').on(table.recordId, table.status),
  }),
);
```

### SQL shape equivalente

```sql
CREATE TABLE animes (
  _id            TEXT PRIMARY KEY,
  nombre         TEXT NOT NULL,
  nrocapvisto    REAL NOT NULL,
  totalcap       INTEGER,
  estado         INTEGER NOT NULL,
  dias           TEXT NOT NULL,
  activo         INTEGER NOT NULL,
  primeravez     INTEGER NOT NULL,
  fecha_ult_cap  INTEGER,
  fecha_estreno  INTEGER,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE operation_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entity         TEXT NOT NULL DEFAULT 'anime',
  record_id      TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  payload        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  retry_count    INTEGER NOT NULL DEFAULT 0,
  error_message  TEXT,
  created_at     INTEGER NOT NULL,
  synced_at      INTEGER
);

CREATE INDEX animes_estado_activo_idx ON animes (estado, activo);
CREATE INDEX animes_updated_at_idx ON animes (updated_at);
CREATE INDEX operation_log_status_created_at_idx ON operation_log (status, created_at);
CREATE INDEX operation_log_record_id_status_idx ON operation_log (record_id, status);
```

> Decisión importante: `operation_log.payload` guarda el **patch final** que después se puede mandar al Bridge casi directo como `PATCH /api/animes/:id`.

---

## 2. Manejo del campo `dias` con custom types de Drizzle

### Problema real
El legacy puede venir como:

```ts
''
// o
'[{"dia":"Lunes","orden":1}]'
// o
[{ dia: 'Lunes', orden: 1 }]
```

SQLite no tiene un tipo JSON nativo con enforcement real como Postgres. Entonces, si vos metés esto “as is”, terminás con tres formas distintas del mismo dato. Eso es veneno para una app offline-first.

### Regla recomendada
1. **ACL/Zod normaliza primero** (`'' -> []`, string JSON -> array, basura -> error).
2. **Drizzle custom type persiste una sola forma canónica**: `TEXT` con JSON stringificado.
3. **Al leer**, Drizzle devuelve siempre `DiaItem[]`.

### Custom type recomendado

```ts
export type DiaItem = {
  dia: DiaNombre;
  orden: number;
};

const normalizeDias = (value: unknown): DiaItem[] => {
  if (value == null || value === '') return [];

  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) return [];

  return parsed.map((item) => ({
    dia: item.dia,
    orden: Number(item.orden),
  }));
};

export const diasJson = customType<{ data: DiaItem[]; driverData: string }>({
  dataType() {
    return 'text';
  },
  toDriver(value) {
    return JSON.stringify(normalizeDias(value));
  },
  fromDriver(value) {
    return normalizeDias(value);
  },
});
```

### Por qué custom type y no solo `text({ mode: 'json' })`
- `text({ mode: 'json' })` te da tipado, sí.
- Pero **NO te resuelve el legacy feo** (`''`, string JSON, shapes incompletos).
- El custom type te deja centralizar serialización/deserialización y asegurar una salida estable.

### Límite sano
No conviertas el custom type en un basurero mágico. Si llega un string inválido o un objeto roto, la ACL debe fallar ANTES de tocar SQLite. El custom type debe tolerar formatos históricos esperados, no inventar datos.

---

## 3. Código conceptual de transacción exclusiva para `Cap+`

```ts
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

async function incrementCap(db: SQLiteDatabase, animeId: string) {
  await db.withExclusiveTransactionAsync(async (txn) => {
    const tx = drizzle(txn, { schema: { animes, operationLog } });

    const current = await tx.query.animes.findFirst({
      where: eq(animes.id, animeId),
    });

    if (!current) {
      throw new Error(`Anime ${animeId} no encontrado`);
    }

    const now = Date.now();
    const nextCap = current.nrocapvisto + 1;

    const patch: AnimePatch = {
      nrocapvisto: nextCap,
      fechaUltCap: now,
      updatedAt: now,
    };

    const reachedEnd =
      current.totalcap !== null &&
      current.totalcap !== undefined &&
      nextCap >= current.totalcap;

    if (reachedEnd) {
      patch.estado = 1; // FINALIZADO
    }

    const isEstreno = current.dias.some((item) =>
      ['Sin ver', 'Ver hoy', 'Visto'].includes(item.dia),
    );

    if (isEstreno && current.primeravez && current.nrocapvisto < 1 && nextCap >= 1) {
      patch.primeravez = false;
      patch.fechaEstreno = now;
    }

    await tx
      .update(animes)
      .set({
        nrocapvisto: patch.nrocapvisto,
        fecha_ult_cap: patch.fechaUltCap,
        updated_at: patch.updatedAt,
        estado: patch.estado ?? current.estado,
        primeravez: patch.primeravez ?? current.primeravez,
        fecha_estreno: patch.fechaEstreno === undefined ? current.fechaEstreno : patch.fechaEstreno,
      })
      .where(eq(animes.id, animeId));

    // 4. Upsert en Outbox Coalescido
    const existingPending = await tx.query.operationLog.findFirst({
      where: and(
        eq(operationLog.record_id, animeId),
        eq(operationLog.status, 'pending')
      ),
    });

    if (!existingPending) {
      // Si no existe, creamos el primer patch pending.
      await tx.insert(operationLog).values({
        record_id: animeId,
        payload: patch,
        status: 'pending',
        created_at: now,
        updated_at: now,
      });
    } else {

// Si existe, mergear el patch nuevo sobre el payload viejo.
      // Regla: el valor más nuevo pisa al viejo.
      const existingPatch = existingPending.payload;
      const mergedPatch: AnimePatch = {
        ...existingPatch,
        ...patch,
      };

      await tx
        .update(operationLog)
        .set({
          payload: mergedPatch,
          updated_at: now,
        })
        .where(eq(operationLog.id, existingPending.id));
    }
  });
}
```

### Qué garantiza esta transacción
- **Exclusividad Real:** Al usar `withExclusiveTransactionAsync`, SQLite en Android aplica un lock a nivel de base de datos. Ningún evento de WebSocket puede leer o escribir mientras esta función se ejecuta.

### Regla de oro
Dentro del callback usá **solo `txn` / `tx`**, nunca el `db` global. Si mezclás conexiones, perdés el aislamiento real y después llorás sangre debuggeando carreras fantasma.

---

## 4. Gotchas de Drizzle + SQLite en mobile

### 4.1 SQLite no tiene tipos “fuertes” de verdad
- `TEXT`, `INTEGER`, `REAL` en SQLite son afinidades, no contratos duros.
- `text(..., { enum })` en Drizzle mejora TypeScript, pero **no crea validación runtime suficiente**.
- Solución: Zod/ACL antes de persistir y, si querés blindaje extra, `CHECK` SQL en migraciones críticas.

### 4.2 Booleanos son `INTEGER`
- En SQLite mobile, `true/false` reales no existen.
- Usá `integer({ mode: 'boolean' })` para `activo` y `primeravez`.
- Nunca asumas que fuera de Drizzle vas a leer `true/false`; por SQL crudo vas a ver `1/0`.

### 4.3 `nrocapvisto` DEBE ser `REAL`
- El legacy ya demostró que existe `0.5`.
- Si lo llevás a `INTEGER`, rompés compatibilidad histórica y los diffs con el Bridge.

### 4.4 Timestamps: `mode: 'number'` vs `timestamp_ms`
- `timestamp_ms` devuelve `Date` en TypeScript.
- Para sync y payloads JSON conviene `mode: 'number'` y guardar Unix ms crudo.
- Si mezclás `Date` con `number`, te llenás de serializaciones inconsistentes.

### 4.5 `text({ mode: 'json' })` NO reemplaza validación
- Sirve para tipado y serialización básica.
- No arregla `''`, strings JSON legacy, ni shape inválido.
- Para `dias` y `payload` con reglas de compatibilidad, mejor custom type + ACL.

### 4.6 `withExclusiveTransactionAsync()` no existe en web
- Excelente para Android/iOS.
- No soportado en web. Si algún día quieren Expo Web, hay que degradar estrategia o abstraer el repositorio.

### 4.7 `database is locked` no es bug: es señal de contención real
- Al usar transacción exclusiva, otros writes async pueden abortar.
- Eso está BIEN.
- Diseñá una cola de mutaciones o un retry corto en el repository; no dispares writes desde cualquier lado como si esto fuera memoria compartida gratis.

### 4.8 `useLiveQuery` necesita `enableChangeListener: true`
- Si abrís la DB sin eso, SQLite persiste igual, pero la UI reactiva no se entera.
- Ese bug es traicionero porque “la data está”, pero React no re-renderiza.

### 4.9 Ojo con `undefined` en `.set()`
- En Drizzle, `undefined` suele significar “no tocar la columna”, no “guardar null”.
- Para patches parciales esto es útil, pero hay que ser explícito cuando querés limpiar valores (`null`).

### 4.10 No mezclar normalización legacy con persistencia final
- `dias: ''`, fechas `$$date`, floats, strings numéricos: todo eso entra por la ACL.
- La tabla local debe quedar canónica. La base offline no puede transformarse en un espejo del caos legacy.

---

## Riesgos
- Si el `operation_log` se diseña campo-a-campo, la reconciliación se vuelve más compleja de lo necesario.
- Si `dias` se guarda sin normalización canónica, la app puede filtrar distinto según de dónde vino el dato.
- Si se usa `db.transaction()`/writes no exclusivos, el WebSocket y la UI pueden interlevar operaciones y dejar estados imposibles.

## Ready for Proposal
Sí. El siguiente paso sano es formalizar esto en propuesta/especificación usando como contrato: **`Cap+` = una transacción exclusiva + un patch log `pending` por intención**.
