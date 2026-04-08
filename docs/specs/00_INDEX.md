# SDD Master Tree — Autoreas Mobile (Refinado post-Simulación Mental)

**Fecha:** 2026-04-05
**Objetivo:** Plan maestro de especificaciones basado en el descubrimiento de "Gotchas" críticos (Lifecycle de Android en Background, Cleartext HTTP Local en Expo, Sync Asíncrono de SQLite vs WS). Estructurado para trabajo en paralelo por agentes.

**Orden estricto de inicio:** `SDD-00 -> SDD-01 -> SDD-02 -> (SDD-03 | SDD-04 | SDD-06 en paralelo) -> SDD-05 -> SDD-07`.

---

## 🏗️ FASE 0: Tracer Bullet y Tooling (El Cimiento de Piedra)

### SDD-00: Tooling, Linters y Decisiones de Build

- **Spec:** Inicializar `npx create-expo-app@latest` con template TypeScript (`expo-router`). Configurar ESLint estricto para React Hooks. Instalar y configurar precommit con Lekfthook (linters, tests, coverage). Instalar y linkear `expo-sqlite`, `drizzle-orm`, `zod`, `@tanstack/react-query`, `zustand`, `heroui-native`.
- **Riesgos Mitigados (Gotchas):** Modificar `app.json` explícitamente para permitir `android:usesCleartextTraffic="true"`, vital para consumir el API del Bridge (`http://192.168.1.X`). Configurar `metro.config.js` para empaquetar archivos `.sql` requeridos por Drizzle.

### SDD-01: Tracer Bullet Inicial (Wiring SQLite)

- **Spec:** Definir el schema mínimo (`schema.ts`). Un componente Dummy en `app/index.tsx` que use `useLiveQuery` (Drizzle) para renderizar un `<Text>` con la cantidad de filas de SQLite. Un botón de "Insert Harcodeado".
- **Criterio de Éxito:** Tocar el botón incrementa el contador del `<Text>` instantáneamente y sin lag, probando que el puente asíncrono de React Native -> JSI -> SQLite funciona.

---

## 📂 FASE 1: Dominio Sync (El Cerebro P2P Asíncrono)

### SDD-02: El Operation Log y Drizzle ORM

- **Spec:** Diseñar la tabla transaccional `operation_log`. Diseñar esquemas Zod rigurosos para validar los JSON legacy (coerción de arrays vacíos `""` -> `[]`, casteo de fechas `$$date`). Implementar `db.transaction()` para mutaciones atómicas locales.
- **Criterio de Éxito:** Un test unitario con Jest y base en memoria mockeada donde un `Cap+` inserta en la tabla `animes` y en `operation_log` (status: `pending`) al mismo tiempo, fallando ambos si uno falla.

### SDD-03: Optimistic Ignorance y WebSocket Lifecycle

- **Spec:** Implementar el listener de WS. **Crucial:** El evento `anime:changed` no debe escribirse a SQLite ciegamente. Debe usar una consulta asíncrona: `SELECT COUNT(*) FROM operation_log WHERE record_id = X AND status = 'pending'`. Solo si es `0`, ejecuta el `UPDATE` en `animes`. El `WebSocket` debe atarse al `AppState` de React Native: desconectar on `background`, reconectar on `active`.
- **Criterio de Éxito:** Simulación donde un evento de WS con `nrocapvisto: 4` llega a un anime con un `pending` local de `Cap+`, y es silenciosamente droppeado.

### SDD-04: Reconciliador REST (El Catch-Up)

- **Spec:** Un Worker en background que lee el `operation_log` (`pending`), lo formatea a JSON, y hace `POST /api/sync/reconcile` al Bridge usando Axios + React Query. Si la respuesta es `200 OK`, actualiza la base local a `synced` y guarda el `last_changelog_id`.
- **Criterio de Éxito:** Test integration: la conexión falla con `Network Error` -> `operation_log` sigue `pending`. Conexión exitosa -> `operation_log` limpio.

---

## 📱 FASE 2: Dominio Catálogo (La UI Offline Extrema)

### SDD-05: HeroUI, Split-Screen Constraints y Lista Reactiva

- **Spec:** Renderizar la lista principal (`app/(tabs)/index.tsx`) consumiendo los hooks de Drizzle del SDD-02. **Condición Inquebrantable:** El layout debe ser mobile-first y funcionar en **split-screen de ~320dp de ancho** (VLC a la izquierda, Autoreas a la derecha). Cero scroll horizontal, `flex-wrap` obligatorio para badges. Los botones de `Cap+` y `Cap-` deben estar siempre visibles a 1 clic, sin entrar a sub-menús. Dropdown nativo para Días.
- **Criterio de Éxito:** Inspeccionar la UI en el emulador forzando 320dp de ancho. Los botones no colapsan ni quedan fuera del canvas. El Dropdown no se corta.

### SDD-06: Mutación Local, Estrenos y Máquina de Estado

- **Spec:** Atar los botones de la UI a las transacciones de SQLite. Implementar la lógica cruzada en cliente: si el usuario toca `Cap+` y `nrocapvisto == totalcap` (ej. 12/12), inyectar automáticamente `estado = 1` en la misma transacción de base de datos. Si el anime pertenece a la pestaña de "Estrenos" (`primeravez == true`), inyectar `fechaEstreno = Date.now()` y `primeravez = false`.
- **Criterio de Éxito:** Tocar Cap+ (12/12) hace desaparecer el anime de la lista "Viendo" instantáneamente y crea dos entradas (o una agrupada) en el `operation_log`.

---

## 🔗 FASE 3: Dominio Device (Boot y Pairing)

### SDD-07: Configuración Síncrona, Formularios y Deep Linking

- **Spec:** Crear `app/setup.tsx`. Formulario manual para `IP`, `Puerto` y `Token`. Al validar contra el Bridge (`POST /api/devices/pair`), si la respuesta es `200 OK` con un `device_id`, escribir sincrónicamente en SQLite `bridge_config` (no usar `SecureStore` para no retrasar el booteo de Zustand en `app/_layout.tsx`). Configurar `expo-linking` para que escanear el QR `autoreas://pair?ip=X...` prepople el formulario.
- **Criterio de Éxito:** Matar la app (kill process). Al reabrir, el `_layout.tsx` lee `bridge_config` de SQLite en <10ms y redirige a la lista de animes salteando el Setup sin flashear pantallas blancas. Scanner de QR auto-completa el form.
