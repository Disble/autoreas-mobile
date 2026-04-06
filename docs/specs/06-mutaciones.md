# SDD-06: Máquina de Estado Local y Mutaciones

**Estado:** Draft (Pendiente de Revisión Adversarial)
**Track:** Catálogo (Fase 2)

## 1. Objetivo
Definir la lógica de negocio del lado del cliente en React Native (Expo) para actualizar el estado de los animes en la base de datos local (SQLite) mediante la UI (botones `Cap+`, `Cap-`, etc.), y cómo estas mutaciones se integran con el Reconciliador (SDD-04) sin causar bloqueos visuales.

## 2. La Verdad Única (SSOT)

A diferencia de las aplicaciones web tradicionales, **NO HABRÁ ESTADO GLOBAL DE UI (Zustand/Redux)** para guardar la lista de animes.
El estado reside al 100% en SQLite.
- Cuando un usuario toca `Cap+`, la función dispara un `UPDATE` a SQLite (`withExclusiveTransactionAsync`).
- Drizzle ORM (`useLiveQuery`) notará el cambio en la base de datos y React Native re-renderizará la lista instantáneamente.
- **Ventaja:** Cero código para manejar optimismo visual en la UI. Si está en DB, se ve. Si falla, no se ve. Si se apaga la app a la mitad del click, el dato está seguro.

## 3. Lógica de Mutación (Máquina de Estado)

Las reglas de negocio (ej. "si llego al último cap, marcar como Visto") deben ejecutarse atómicamente en la misma transacción de SQLite.

### 3.1. `Cap+` (Incremento de Capítulo con Seguridad Atómica)
```javascript
// Pseudo-código usando Drizzle (con WAL activado para evitar locks de lectura)
await db.transaction(async (tx) => {
  // 1. SELECT atómico dentro de la transacción
  const [anime] = await tx.select().from(animes).where(eq(animes.id, targetId)).limit(1);
  
  // Bugfix: Evitar que totalcap null/0 resetee a 0 el progreso
  const limite = (anime.totalcap > 0) ? anime.totalcap : Infinity;
  const newCap = Math.min(anime.nrocapvisto + 1, limite);
  const newEstado = (anime.totalcap > 0 && newCap === anime.totalcap) ? 1 : anime.estado; // 1 = Visto
  
  // Regla de Estrenos:
  const newPrimeraVez = false;
  const newFechaEstreno = (anime.primeravez) ? Date.now() : anime.fechaEstreno;

  // 1. Mutar Anime localmente (SSOT)
  await tx.update(animes)
    .set({ nrocapvisto: newCap, estado: newEstado, primeravez: newPrimeraVez, fechaEstreno: newFechaEstreno })
    .where(eq(animes.id, targetId));

  // 2. Insertar en Operation Log (Upsert Coalescido de SDD-02)
  // Requisito: La tabla operation_log DEBE tener un UNIQUE INDEX en (record_id, status) donde status = 'pending' (Partial Index en SQLite).
  // Y el merge de JSON debe hacerse en el motor SQL (json_patch), no en memoria, si es concurrente.
  await tx.insert(operation_log)
    .values({ record_id: targetId, status: 'pending', payload: { nrocapvisto: newCap, estado: newEstado } })
    .onConflictDoUpdate({ 
      targetWhere: sql`record_id = ${targetId} AND status = 'pending'`,
      set: { payload: sql`json_patch(payload, ${JSON.stringify({ nrocapvisto: newCap, estado: newEstado })})` } 
    });
});
```

## 4. Bloqueo de UI y Manejo de Concurrencia (WAL)
Dado que el usuario podría tocar 5 veces `Cap+` en 50ms:
- **Write-Ahead Logging (WAL):** SQLite debe estar configurado en modo `WAL` desde el SDD-01. Las transacciones no usarán `withExclusiveTransactionAsync` para mutaciones locales de UI, sino la transacción diferida estándar. Esto evita que un click rápido bloquee el hilo de lectura de `useLiveQuery` provocando stutters ("database is locked").
- **Requisito UI:** El botón `Cap+` NO debe depender de estado reactivo para debouncing. Se usará un `useMutation` de TanStack Query o Zustand (flag transitorio `isMutating`) para desactivar el botón durante los 5-10ms que dura la transacción SQLite.