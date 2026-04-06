# SDD: 01-foundation (Revisión Adversarial)

**Estado:** Aprobado (v2)
**Track:** Fase 0 (Bloqueante)
**Ubicación:** `src/infrastructure/`

Esta especificación inicializa las bases técnicas del proyecto. Su diseño fue sometido a revisión adversarial para garantizar su funcionamiento real en dispositivos Android con las APIs modernas de `expo-sqlite` (SDK 50+) y `drizzle-orm`.

---

## 1. Esquemas Zod (Anti-Corruption Layer)

Se define `AnimeSchema` y `OperationLogSchema` en `src/infrastructure/validation/schemas.ts`.

### Escenarios de Validación Obligatorios

1. **Soporte Numérico Fraccional (El Edge Case `0.5`):**
   - Un payload legacy con `nrocapvisto: 0.5` debe ser aceptado por `AnimeSchema` sin redondeo ni truncamiento, y persistirse como `REAL` en SQLite. **No usar `z.number().int()`**.

2. **Normalización de Fechas Legacy (`$$date`):**
   - El schema debe soportar múltiples formatos históricos: `{ "$$date": 1710000000000 }`, `1710000000000`, `null`, o string numérico. Se utilizará un helper Zod explícito para extraer el timestamp UNIX en milisegundos y descartar el wrapper de objeto.

3. **Coerción de Arrays Vacíos:**
   - Un JSON del legacy con `generos: ""` (string vacío) o `dias: ""` se coerciona a `[]` mediante `.transform()` en Zod, garantizando la persistencia estructurada.

4. **Rechazo de Basura Legacy:**
   - Un JSON con `estado: 5` o `nrocapvisto: "tres"` falla la validación con un `ZodError` descriptivo y no se inserta en SQLite.

---

## 2. Base de Datos Local (Drizzle ORM + expo-sqlite)

Se configuran las tablas `animes`, `operation_log`, y `bridge_config` en `src/infrastructure/db/schema.ts`.

### Restricciones de Apertura y Concurrencia (Crucial para Android)

1. **Live Queries:**
   - La base de datos DEBE abrirse con `{ enableChangeListener: true }` (`openDatabaseSync("autoreas.db", { enableChangeListener: true })`). De omitirse, el hook `useLiveQuery` de Drizzle no re-renderizará la UI ante cambios.

2. **Transacciones Exclusivas (Protección P2P):**
   - Las mutaciones críticas (ej. inserción simultánea en `animes` y `operation_log`) **no** usarán `db.transaction()` estándar.
   - Se DEBE utilizar la API nativa de Expo: `withExclusiveTransactionAsync()` para garantizar el bloqueo real (Lock) a nivel de SQLite en Android, evitando que listeners concurrentes del WebSocket corrompan la integridad del Write-Through.

---

## 3. Integración de Migraciones (Metro Bundler)

React Native no resuelve archivos `.sql` por defecto, lo que provoca crashes en tiempo de ejecución al intentar importar las migraciones de Drizzle.

### Configuración Estricta Requerida

1. **Dependencias:** `bun add -D drizzle-kit babel-plugin-inline-import`
2. **`babel.config.js`:**
   ```javascript
   plugins: [["inline-import", { extensions: [".sql"] }]]
   ```
3. **`metro.config.js`:**
   ```javascript
   config.resolver.sourceExts.push("sql");
   ```
4. **`drizzle.config.ts`:**
   ```typescript
   export default defineConfig({ dialect: "sqlite", driver: "expo" });
   ```

---

## 4. Boot Routing Seguro (UI No Bloqueante)

Para evitar Jank (congelamiento de pantalla) o Application Not Responding (ANR) en dispositivos Android de gama baja, el arranque **no debe usar consultas síncronas pesadas en el layout principal**.

### Escenario de Enrutamiento Asíncrono

1. El `app/_layout.tsx` retiene el Splash Screen nativo.
2. Renderiza el `<SQLiteProvider databaseName="autoreas.db" onInit={runMigrations} useSuspense>` nativo de Expo.
3. La función `onInit` es **asíncrona** (`async/await`). Ejecuta el PRAGMA WAL, corre las migraciones de Drizzle y consulta la tabla `bridge_config`.
4. Una vez que `onInit` resuelve, el Provider inyecta la DB al contexto de Drizzle, libera el Splash Screen, y el Router decide si navega a `/setup` (Pairing) o `/(tabs)/index` (Catálogo) basándose en un estado en memoria, **no** bloqueando el Main Thread de JavaScript.

---

## 5. Network Security (El Bloqueo de HTTP Local)

Android 9+ bloquea tráfico HTTP en texto plano (Cleartext) por defecto, provocando fallos de `Network Error` en Axios incluso si la IP local es correcta.

### Configuración Obligatoria (`app.json`)

Se debe forzar el permiso mediante plugin nativo antes de compilar (requiere `npx expo run:android` o EAS Build; no funciona en Expo Go puro):

```json
{
  "expo": {
    "plugins": [
      [
        "expo-build-properties",
        {
          "android": {
            "usesCleartextTraffic": true
          }
        }
      ]
    ]
  }
}
```