# Design: Restore Mis Animes legacy day layout

## Technical Approach

Reencauzar `Mis Animes` al modelo definido por el RFC: selector compacto de día/estrenos + lista reactiva desde SQLite. La pantalla seguirá leyendo una colección local viva, pero el criterio visible dejará de ser “estado + última actividad” y pasará a ser “filtro seleccionado + orden del día”.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|---|---|---|---|
| Source of truth | Bridge directo vs SQLite local | SQLite local | Mantiene offline-first, evita acoplar render al network layer y ya coincide con SDD-06 |
| Filter model | Tabs por estado vs selector día/estrenos | Día/estrenos | Es el contrato del design doc y la expectativa del cliente |
| Ordering | `fechaUltCapVisto` vs `dias[].orden` | `dias[].orden` del filtro activo | Replica el modelo legacy dentro del día seleccionado |
| Refresh UX | Navegación global vs acción de pantalla | Acción local de pantalla | Permite sync explícito sin perder el filtro activo |
| Filtering implementation | SQL JSON complejo vs helper puro sobre rows activas | Helper puro inicial | Menor riesgo con `dias` persistido como JSON string y suficiente para el volumen actual |

## Data Flow

`SQLite animes rows` → `useAnimeList(selectedFilter)` → `parse/filter/sort helpers` → `useAnimeListScreen` → `AnimeListScreen.tsx`

`refresh action` → `useIncrementalSyncHandler` (o helper equivalente de refresh completo) → `SQLite update` → `live query` → re-render con mismo filtro.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/features/animes/anime.types.ts` | Modify | Reemplazar `AnimeTab` por modelo de filtro legacy (`weekday`/`estrenos`) |
| `src/features/animes/anime.constants.ts` | Modify | Declarar opciones de selector y labels derivados del doc |
| `src/features/animes/anime.helpers.ts` | Modify | Agregar helpers puros para obtener match/orden por día y pseudo-días |
| `src/features/animes/use-anime-list.ts` | Modify | Leer rows locales y devolver lista filtrada/ordenada por filtro activo |
| `src/features/animes/ui/AnimeListScreen/anime-list-screen.types.ts` | Modify | Exponer selectedFilter, refresh state y handlers nuevos |
| `src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts` | Modify | Resolver filtro inicial, cambio de selector y refresh manual |
| `src/features/animes/ui/AnimeListScreen/AnimeListScreen.tsx` | Modify | Reemplazar `Tabs` por selector compacto + trigger de refresh HeroUI Native |
| `src/features/animes/ui/AnimeEmptyState/*` | Modify | Ajustar mensajes al nuevo modelo día/estrenos |
| `tests/features/animes/*` | Modify/Create | Validar helpers, hook de lista y hook de pantalla |

## Interfaces / Contracts

```ts
type AnimeDayFilter =
  | "Lunes" | "Martes" | "Miércoles" | "Jueves"
  | "Viernes" | "Sábado" | "Domingo"
  | "Sin ver" | "Ver hoy" | "Visto";
```

Helpers clave:
- `getDefaultAnimeDayFilter(now)`
- `getAnimeOrderForFilter(anime, filter)`
- `matchesAnimeDayFilter(anime, filter)`
- `sortAnimesBySelectedDay(animes, filter)`

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Día default, match por `dias`, orden ascendente, exclusión sin match | Jest sobre helpers puros |
| Hook | `useAnimeList` devuelve solo el filtro activo y ordenado | renderHook + mocks de live query |
| Hook | `useAnimeListScreen` conserva filtro al refrescar y dispara sync | renderHook + mocks de sync/mutation |
| UI | Selector + refresh visibles sin tabs legacy | test de render si ya existe harness; si no, smoke hook/view-model |

## Migration / Rollout

No migration required. `dias` ya existe en SQLite y en el contrato Bridge. El rollout es un reemplazo de comportamiento de pantalla.

## Open Questions

- [ ] Confirmar si refresh manual debe ejecutar `incrementalSync(rawDb, 0)` o `initialSync(rawDb)` para forzar baseline completo.
- [ ] Definir el componente HeroUI Native exacto para selector compacto (Picker/Input compuesto o menú custom) sin violar split-screen.
