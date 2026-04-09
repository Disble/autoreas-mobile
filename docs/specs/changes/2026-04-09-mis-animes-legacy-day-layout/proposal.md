# Proposal: Restore Mis Animes legacy day layout

## Intent

Realinear `Mis Animes` con el design doc y la UX esperada por el cliente. La implementación actual derivó a tabs por estado (`viendo/estrenos/todos`) y orden por `fechaUltCapVisto`, pero el producto debe operar por día seleccionado + grupo Estrenos, preservando el `dias[].orden` entregado por Bridge.

## Scope

### In Scope
- Reemplazar la navegación principal por selector de día / pseudo-día de Estrenos.
- Filtrar y ordenar la lista local por `dias[].dia` + `dias[].orden`.
- Seleccionar el día actual por defecto y mantener la selección durante refresh.
- Agregar refresh manual sin romper el modelo offline-first.
- Ajustar estados vacíos y copy para reflejar el modelo legacy.

### Out of Scope
- Rehacer la UI exacta de sidebar desktop en mobile.
- Búsqueda, edición avanzada, portadas reales o cambios del contrato Bridge.
- Reescribir otras pantallas fuera de `Mis Animes`.

## Approach

Mantener SQLite como SSOT. `AnimeListScreen` seguirá siendo UI tonta; un hook de pantalla resolverá la selección activa y un hook/helper de catálogo devolverá los animes visibles ya filtrados/ordenados. El refresh manual ejecutará sync contra Bridge y dejará que la live query repinte la lista.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/features/animes/use-anime-list.ts` | Modified | Cambiar tabs por selección día/estrenos y orden legacy |
| `src/features/animes/ui/AnimeListScreen/*` | Modified | Reemplazar tabs por selector + refresh |
| `src/features/animes/*types|*constants|*helpers` | Modified/New | Modelar opciones de filtro y parsing/orden |
| `tests/features/animes/*` | Modified/New | Cobertura RED/GREEN de filtros, orden y refresh |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Interpretar mal pseudo-días de Estrenos | Medium | Documentar reglas y cubrirlas con escenarios explícitos |
| Romper split-screen por nuevo selector | Medium | Diseñar control compacto y validar 320dp |
| Refresh duplicando sync o cambiando selección | Medium | Hook dedicado con guardas y tests de persistencia de selección |

## Rollback Plan

Revertir el cambio folder completo y restaurar el flujo actual de tabs por estado. No requiere migración de datos porque la persistencia de `animes` no cambia.

## Dependencies

- Bridge ya expone `dias[].dia` y `dias[].orden` en `GET /api/animes` / `GET /api/animes/{id}`.

## Success Criteria

- [ ] `Mis Animes` abre en el día actual y no en tabs por estado.
- [ ] La lista muestra solo los animes del filtro activo y respeta `dias[].orden`.
- [ ] El refresh manual sincroniza y conserva el filtro activo.
