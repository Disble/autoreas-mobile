# Proposal: Complete mobile background sync

## Intent

Cerrar el gap entre RFC/design docs y el runtime real. Hoy la app sincroniza en pairing, mutaciones locales y foreground parcial, pero no cumple la promesa de sync automático cuando el bridge y la tablet vuelven a estar disponibles sin intervención del usuario.

## Scope

### In Scope
- Mover la orquestación de sync desde screens puntuales a un runtime de app montado en root.
- Disparar reconcile automático al volver a `active`, al recuperar red y desde un background task periódico.
- Registrar un worker headless que abra SQLite, lea `bridge_config` y ejecute el mismo reconcile seguro.
- Mantener WebSocket sólo para foreground, pero coordinado con el runtime global.
- Exponer en Settings el estado observable del runtime/background sync para soporte y debugging del usuario.

### Out of Scope
- Descubrimiento automático del bridge por mDNS.
- Reemplazar el contrato actual del bridge o agregar endpoints nuevos.
- Resolver conflictos en mobile.

## Approach

Conservar SQLite como SSOT y reutilizar `syncPendingOperations()` como primitive única de reconcile/catch-up. Encima de eso, agregar un runtime global con triggers de AppState + red y un background task best-effort con `expo-background-task`/`expo-task-manager` para Android/iOS soportados.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/features/sync/*` | Modified/New | Runtime global, triggers de disponibilidad y worker headless |
| `src/features/ws/*` | Modified | WS coordinado con el runtime root |
| `src/features/setup/ui/AppRootLayout/*` | Modified | Montaje temprano del sync runtime |
| `src/features/settings/*` | Modified/New | Superficie de estado para background/runtime sync |
| `src/infrastructure/db/*` | Modified | Apertura segura de DB para tareas headless |
| `app.json`, `package.json` | Modified | Dependencias y config nativa para background task vía Bun |
| `tests/features/sync/*`, `tests/features/ws/*` | Modified/New | Cobertura de triggers, dedupe y worker |
| `tests/features/settings/*` | Modified/New | Cobertura de observabilidad en Settings |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Tareas de fondo no corren inmediatamente | High | Diseñar como best-effort + foreground active/network triggers |
| Doble sync por múltiples triggers | Medium | Reusar guard in-flight existente y serializar fuentes |
| Task headless sin DB/config válida | Medium | No-op explícito y tests de bootstrap headless |

## Rollback Plan

Revertir el change folder y volver al wiring actual de screen-level sync. No requiere migraciones de datos ni rollback de SQLite schema.

## Dependencies

- `expo-background-task`
- `expo-task-manager`
- `expo-network`
- Instalación con `bun add`, no `npm install`

## Success Criteria

- [ ] La app sincroniza automáticamente al volver a foreground y al recuperar conectividad.
- [ ] Existe un background task registrado para dispositivos pareados que ejecuta reconcile headless sin UI.
- [ ] El runtime de sync ya no depende de montar `AnimeListScreen`.
- [ ] Settings muestra si el background sync está registrado, su último intento y su último error observable.
