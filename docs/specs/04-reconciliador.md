# SDD-04: Reconciliador REST (El Catch-Up)

**Estado:** Draft (Pendiente de Revisión Adversarial)
**Track:** Sync (Fase 1)

## 1. Objetivo
Implementar el proceso en segundo plano (Worker/Reconciliador) que se encarga de enviar las mutaciones locales pendientes al Bridge (PC) y de recuperar el estado perdido (Catch-up) en caso de desconexiones del WebSocket.

## 2. El Problema de la Doble Escritura (Race Condition)
Dado que usamos un "Outbox Coalescido" (una sola fila pending por anime en `operation_log`), existe un riesgo crítico:
1. El Reconciliador lee el log pendiente (v1).
2. Inicia la petición HTTP `POST /api/sync/reconcile`.
3. El usuario toca "Cap+" (v2). El log se actualiza a v2 (`status = 'pending'`).
4. La petición HTTP de v1 termina con `200 OK`.
5. El Reconciliador marca la fila como `synced` o la borra. **¡Se pierde v2!**

## 3. Flujo de Reconciliación Seguro (Lock de Estado)

Para evitar perder datos, el Reconciliador debe usar un estado intermedio `processing` y payloads idempotentes absolutos:

1. **Recuperación de Stale Locks (Crash Recovery):**
   Al bootear la app (o al inicio de cada ciclo de reconciliación), devolver a `pending` los locks huérfanos por un cierre inesperado:
   `UPDATE operation_log SET status = 'pending' WHERE status = 'processing';`
2. **Lockeo Local:** 
   `UPDATE operation_log SET status = 'processing' WHERE status = 'pending' RETURNING *;`
3. **Envío Idempotente:** Se envían todos los registros `processing` al Bridge en un solo batch JSON. **Crucial:** El payload NO DEBE ser relativo (ej. `+1 cap`), debe ser el estado absoluto resultante (ej. `nrocapvisto: 5`) para que, si hay un reintento por timeout de red, la PC no duplique la acción.
4. **Mutaciones Concurrentes:** Si el usuario muta algo durante el paso 3, el SDD-02 (Outbox Coalescido) hará un `UPSERT` que devolverá el registro a `status = 'pending'`, preservando la nueva intención del usuario.
5. **Resolución Exitosa (200 OK):**
   `DELETE FROM operation_log WHERE status = 'processing';`
   (Si el usuario mutó algo, ese registro estará en `pending`, por lo que el `DELETE` no lo tocará, preservando v2 para el próximo ciclo).
6. **Resolución Fallida (Manejo de Errores):**
   - **5xx o Error de Red:** `UPDATE operation_log SET status = 'pending' WHERE status = 'processing';` (Reintento infinito con backoff).
   - **4xx (Bad Request / Data Inválida):** `UPDATE operation_log SET status = 'dead_letter' WHERE status = 'processing';` (Fallo permanente para evitar un loop infinito venenoso que bloquee la cola. Se debe mostrar en la UI o loguear para el dev).

## 4. Catch-up (Delta Sync)
Al recuperar conectividad, antes de procesar el Outbox, el Reconciliador pide al Bridge los cambios ocurridos en la PC usando el último `version` conocido. Los cambios entrantes pasan por la misma lógica de "Optimistic Ignorance" definida en SDD-03.