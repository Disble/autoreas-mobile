# Mobile Sync Status UX

The Settings screen answers one question: **"are my changes safe and reaching the PC?"** It is a
status page, not a runtime log. A PC that is off is the normal state and never reads as an error;
only a sync that the PC actively rejected turns the screen red.

This document is the contract for what the user sees. The code is the runtime truth:

- Shared status copy and tone: `src/features/sync/sync-visible-status.helpers.ts`
  (`deriveVisibleSyncStatus`), also used by the anime list.
- Settings icon, meta line and action: `src/features/settings/ui/SettingsScreen/settings-sync-status.helpers.ts`
  (`buildSettingsSyncSummary`).
- Settings copy: `src/features/settings/ui/SettingsScreen/settings-screen.constants.ts`.

If this page and the code disagree, the code wins and this page is the bug.

## Why a PC that is off is normal

The bridge runs on the user's own PC. The app is local-first: every change is stored on the device
first, and sync retries on its own until the PC answers. So:

- The PC being off, asleep, or on another network loses nothing. The changes wait on the device.
- The user cannot fix "PC off" from the app, so an alarm about it is noise that trains them to
  ignore the screen.
- Re-pairing does not help an unreachable PC. It is only the remedy when the PC or the bridge
  install changed.

## Tone ladder

| Tone | When | Never |
|---|---|---|
| `default` (neutral) | PC unreachable, no Wi-Fi, no PC paired, nothing to send | — |
| `accent` | A sync is running | — |
| `success` | Online with nothing pending | — |
| `warning` | Pending changes **and** at least 72 h (`SYNC_VISIBLE_STATUS_STALE_WARNING_HOURS`) since the last successful sync | Fewer than 72 h, or no pending changes |
| `danger` | `sync_error`: the PC answered and rejected the send | Waiting, however long. Waiting caps at `warning` |

The 72 h warning asks whether the PC is on; it never implies that data was lost.

## State table

Evaluated top to bottom; the first matching row wins. `N` is the pending change count, with
singular wording when `N = 1` ("1 cambio guardado", "Se enviará"). `<recency>` is
`formatLastSyncRecency`: "hace un momento", "hace N min", "hace N h", "hace N días".

| State | Title | Description | Chip | Tone | Action |
|---|---|---|---|---|---|
| Sync running | Sincronizando | Enviando tus cambios a la PC. | Sincronizando | `accent` | none |
| Online, nothing pending | Al día | Último sync `<recency>`. (or "Todo lo que cambiaste ya está en la PC." with no previous sync) | Al día | `success` | Sincronizar ahora |
| `sync_error` | La PC no aceptó tus cambios | La PC respondió, pero rechazó el envío. Tus cambios siguen guardados en este dispositivo. | Envío rechazado | `danger` | Reintentar ahora |
| No PC paired, nothing pending | Sin PC emparejada | La app funciona igual con tu catálogo en este dispositivo. Empareja una PC para tener una copia allí. | Modo local | `default` | Emparejar PC |
| No Wi-Fi, nothing pending | Sin Wi-Fi | Tu catálogo sigue disponible en este dispositivo. | Sin Wi-Fi | `default` | Sincronizar ahora (disabled) |
| PC unreachable or not yet checked, nothing pending | Nada por enviar | Último sync `<recency>`. (or "La PC todavía no respondió.") | Nada por enviar | `default` | Sincronizar ahora |
| No PC paired, `N` pending | N cambios guardados en este dispositivo | Empareja una PC para tener una copia allí. | Modo local | `default` | Emparejar PC |
| No Wi-Fi, `N` pending | Sin Wi-Fi | Tienes N cambios guardados en este dispositivo. Se enviarán cuando vuelvas a conectarte. | Sin Wi-Fi | `default` | Reintentar ahora (disabled) |
| `N` pending, last sync ≥ 72 h ago | Hace D días que no hay sync | Tus N cambios siguen guardados en este dispositivo, pero la PC no los ha recibido. ¿Está encendida y en la misma red? | Esperando a la PC | `warning` | Reintentar ahora |
| `N` pending, PC unreachable or not yet checked | Esperando a la PC | Tienes N cambios guardados en este dispositivo. Se enviarán solos cuando la PC esté encendida. | Esperando a la PC | `default` | Reintentar ahora |

Action rules (`resolveStatusAction`):

- With no PC paired, the action is "Emparejar PC" (go to setup).
- While a sync runs, there is no action.
- Otherwise it is a manual sync, labelled "Reintentar ahora" when changes are pending or the last
  sync was rejected, and "Sincronizar ahora" otherwise. It is disabled while a sync cannot start
  (`isManualSyncAvailableNow`: no Wi-Fi, no PC paired, or a sync already running).
- Re-pairing is **never** the status card action.

Meta line (`buildStatusMeta`): only while changes are pending and a PC is paired, as
"Último sync `<recency>` · N por enviar". With nothing pending the description already carries the
recency, so the meta line is hidden.

## Settings layout

Top to bottom (on a tablet in landscape the connection card sits beside the background and privacy
cards):

1. **Status card.** Icon, title, description, chip and meta line from the table above, plus the
   single contextual action.
2. **Connection card** ("Conexión con la PC"). PC host and port, this device's id (selectable, so it can be copied), and
   "Re-emparejar" as a secondary action for a changed PC or a reinstalled bridge. Hidden while no
   PC is paired.
3. **Background card** ("Segundo plano"). One line, "Sync automático activo", when everything
   works. Otherwise it lists only the items to fix, each with its fix: background not supported,
   service not running ("Abrir ajustes"), battery limited ("Permitir"), persistent notification
   disabled ("Abrir ajustes", only in foreground-service mode). Before pairing it says
   "Se activa al emparejar una PC."
4. **Privacy card.** The "Enviar diagnóstico a la PC" toggle.

## Copy rules

- Address the user with **tú** ("Empareja", "Tienes"), never voseo ("Emparejá").
- Say **"dispositivo"**, never "teléfono": the app runs on tablets.
- Headlines say **"la PC"**. "Bridge" stays only in pairing and technical contexts (for example the
  re-pair description).
- No system words in status copy: no "reconciliar", "sync pendiente", raw URLs, or UTC timestamps.

## Runtime counters are not shown in the app

Settings deliberately renders no runtime counters (pending queues, dead letters, exhausted
conflicts, stuck processing, shed rows, cycle stages). Those facts reach the bridge through
diagnostics telemetry and are inspected through the bridge MCP, not by opening the app. See
[`mobile-diagnostic-telemetry.md`](./mobile-diagnostic-telemetry.md) for that channel. The runtime
snapshot is still written; only the screen stopped rendering it.
