# Tasks: Restore Mis Animes legacy day layout

## Phase 1: Domain filter model

- [x] 1.1 Red: crear `tests/features/animes/anime.helpers.test.ts` para default day, match por `dias`, orden ascendente y exclusión sin match.
- [x] 1.2 Green: actualizar `src/features/animes/anime.types.ts`, `anime.constants.ts` y `anime.helpers.ts` con el modelo de filtro legacy y helpers puros documentados.
- [x] 1.3 Refactor: eliminar referencias a `AnimeTab` y dejar contratos reutilizables para día/estrenos.

## Phase 2: Reactive list logic

- [x] 2.1 Red: actualizar `tests/features/animes/use-anime-list.test.ts` para exigir filtrado por día/pseudo-día y orden por `dias[].orden`.
- [x] 2.2 Green: modificar `src/features/animes/use-anime-list.ts` para consumir rows locales y devolver solo los animes visibles del filtro activo.
- [x] 2.3 Refactor: asegurar fallback estable si dos animes comparten el mismo `orden` sin volver a `fechaUltCapVisto` como criterio principal.

## Phase 3: Screen state and refresh

- [x] 3.1 Red: crear/actualizar tests para `use-anime-list-screen` cubriendo filtro inicial según día actual, cambio de selección y refresh conservando estado.
- [x] 3.2 Green: modificar `src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts` para manejar `selectedFilter`, `isRefreshing` y acción manual de sync.
- [x] 3.3 Green: actualizar `anime-list-screen.types.ts` con view-model del selector y refresh.

## Phase 4: UI realignment

- [x] 4.1 Actualizar `src/features/animes/ui/AnimeListScreen/AnimeListScreen.tsx` para reemplazar `Tabs` por selector compacto HeroUI Native + botón/gesto de refresh.
- [x] 4.2 Ajustar `src/features/animes/ui/AnimeEmptyState/*` para mensajes específicos del filtro día/estrenos.
- [x] 4.3 Verificar que `src/app/(tabs)/**` siga siendo solo composición y no absorba lógica del nuevo flujo.

## Phase 5: Verification

- [x] 5.1 Ejecutar las suites de Jest afectadas para helpers y hooks de `animes`.
- [ ] 5.2 Validar manualmente que `Mis Animes` abre en el día actual, mantiene el filtro al refrescar y ya no muestra tabs `viendo/estrenos/todos`.
