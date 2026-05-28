# Plan de Tracer Bullets — Autoreas Mobile (Desarrollo Paralelo)

**Fecha:** 2026-04-05
**Estado:** Activo
**Objetivo:** Estructurar el desarrollo no como una secuencia lineal de UI y red, sino como un **árbol de dependencias** basado en balas trazadoras (Tracer Bullets) que atraviesan todas las capas del sistema simultáneamente, validando los riesgos técnicos reales de Android y Expo desde el Día 1.

---

## 🌳 El Tronco (Fase 0): Foundation y Wiring (El Cimiento)

La única dependencia dura del proyecto. El objetivo es probar que React Native puede hablar con SQLite y que el motor reactivo funciona, sin interfaces bonitas ni red real.

- **Tracer 0.1 (Base de Datos):** Configurar `expo-sqlite` y `drizzle-orm`. **Riesgo Mitigado:** Configurar Metro Bundler para importar archivos `.sql` (migraciones) correctamente en el bundle de Android sin crashear al inicio.
- **Tracer 0.2 (Reactividad):** Crear un schema mínimo (`animes`), inyectar un registro harcodeado en SQLite, y usar el hook `useLiveQuery` de Drizzle para pintar un simple `<Text>` en pantalla.
- **Tracer 0.3 (Anti-Corruption):** Validar con Zod un objeto JSON malformado simulando la salida del Bridge, y que el linter (`eslint-plugin-react-hooks`) y TypeScript estén en verde (strict mode).

*Una vez que un `<Text>` en la pantalla se actualiza solo cuando SQLite cambia, el tronco está listo. El desarrollo se bifurca en ramas independientes.*

---

## 🌿 Rama 1: Dominio Catálogo y Mutaciones (La UI Offline)
*No sabe nada de red, ni de WebSockets, ni de IPs. Todo ocurre en la DB local.*

- **Tracer 1.1 (Read-Only UI):** Construir la lista de animes con HeroUI Native (o RN base si HeroUI falla). **Riesgo Mitigado:** Asegurar que todo se vea bien en `width: 320dp` (Split-Screen extremo). Cero scroll horizontal.
- **Tracer 1.2 (Write-Through y Transacciones):** Botones Cap+ y Cap-. Al presionar, ejecutar una transacción SQL única (`db.transaction()`):
  1. `UPDATE animes SET nrocapvisto = nrocapvisto + 1`
  2. `INSERT INTO operation_log (..., status='pending')`
- **Tracer 1.3 (Auto-completado):** Lógica de negocio (Zustand/Hooks) para que si `nrocapvisto == totalcap`, se inyecte también `estado = 1` en la misma transacción.

---

## 🌿 Rama 2: Dominio Sync (El Cerebro P2P)
*No sabe nada de HeroUI, Dropdowns o botones. Es un Worker silencioso que habla REST y WS.*

- **Tracer 2.1 (HTTP Local Cleartext):** Instanciar Axios. **Riesgo Crítico Mitigado:** Modificar `app.json` de Expo para inyectar `android:usesCleartextTraffic="true"`, o de lo contrario Android bloqueará las peticiones `http://192.168.1.x` por no ser HTTPS.
- **Tracer 2.2 (Reconciliación):** Hook `useReconciler`. Lee el `operation_log` -> Envía `POST /api/sync/reconcile` (harcodeado) -> Si 200 OK -> Hace un `UPDATE operation_log SET status = 'synced'`.
- **Tracer 2.3 (Optimistic Ignorance via WS):** Conectar WebSocket. Al recibir mensaje `anime:changed`, el *listener asíncrono* hace un `SELECT COUNT` en el `operation_log` para ese `_id`. Solo hace el `UPDATE` a `animes` si el conteo es 0.

---

## 🌿 Rama 3: Dominio de Red y Ciclo de Vida (El Conector)
*No sabe de animes, solo transporta configuración y maneja el SO.*

- **Tracer 3.1 (Formulario de IP Manual):** Input simple para guardar IP y Token en la tabla `bridge_config` sincrónicamente (no usar SecureStore por asincronía de boot).
- **Tracer 3.2 (AppLifecycle y Resurrección):** Usar `AppState` de React Native. **Riesgo Crítico Mitigado:** Cuando la app pasa a background, Android mata el WebSocket. Al volver a `active`, el sistema *debe* forzar un `POST /api/sync/reconcile` y re-abrir el WS obligatoriamente.
- **Tracer 3.3 (Deep Linking QR):** Configurar `expo-linking` + `expo-camera` para capturar `autoreas-mobile://pair?v=1&ip=...` desde el QR del Bridge y pre-popular/autosubmit el Tracer 3.1 sin perder el fallback manual.

---

## 🤝 La Copa del Árbol (Integración Final)

Como cada rama se desarrolló sobre la Base de Datos SQLite (El Tronco), la integración sucede casi sin código adicional:
1. El usuario pega la IP en el Formulario (Rama 3).
2. Se descarga la lista y se inserta en SQLite (Rama 2).
3. La UI automáticamente pinta la lista porque `useLiveQuery` está escuchando la DB (Rama 1).
4. El usuario toca Cap+ (Rama 1). Se inserta en SQLite y `operation_log`.
5. El Sync Engine (Rama 2) detecta el `pending`, lo manda al PC y actualiza el estado.
