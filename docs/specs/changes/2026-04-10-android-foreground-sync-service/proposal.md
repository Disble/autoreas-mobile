# Proposal: Android foreground sync service

## Intent

Cerrar el gap entre el background sync best-effort actual y la expectativa de continuidad cuando el usuario saca la app del foreground o la cierra manualmente. En Android, eso requiere un foreground service visible con notificación persistente.

## Scope

### In Scope
- Diseñar un modo Android-only con foreground service para sync continuo y observable.
- Mantener la implementación actual best-effort como fallback para iOS y builds sin soporte nativo.
- Exponer en Settings el modo activo: best-effort vs foreground service.
- Definir notificación persistente, acciones de stop y límites operativos.

### Out of Scope
- Implementar el servicio en este change.
- Garantizar el mismo comportamiento en iOS.
- Resolver mDNS/discovery.

## Approach

Agregar un runtime Android especializado apoyado preferentemente en `@notifee/react-native`, usando foreground service + notificación persistente en una development build o workflow prebuild/bare. El worker seguirá reutilizando `syncPendingOperations()` y el snapshot SQLite actual.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/features/sync/*` | Modified/New | Runtime Android con modo foreground service |
| `src/features/settings/*` | Modified | Mostrar modo operativo y controles del servicio |
| `android/*`, `app.json` | Modified | Permisos, service declarations, notification channel |
| `docs/*` | Modified | Limitaciones y nuevo modo Android |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Tradeoff UX por notificación persistente | Medium | Tratarla como un patrón normal de sync continuo tipo Syncthing, con copy claro y opción de stop |
| Expo managed insuficiente | High | Asumir prebuild/dev build o bare como prerequisito |
| Restricciones Android 14+ | Medium | Declarar foreground service type correcto y permisos explícitos |

## Rollback Plan

Mantener el modo actual best-effort y quitar el foreground service Android sin tocar el reconciler ni el snapshot SQLite.

## Dependencies

- `@notifee/react-native`
- Notificación persistente + channel
- Integración nativa compatible con Expo development build/prebuild

## Success Criteria

- [ ] Existe un diseño validado para sync continuo Android con foreground service y notificación persistente.
- [ ] La documentación explica por qué el modo actual no garantiza sync tras kill manual.
- [ ] Settings puede distinguir entre modo best-effort y modo foreground service.
