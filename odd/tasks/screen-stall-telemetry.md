# Screen stall telemetry

Objective: report to the bridge every time the screen takes 2 s or more to show a change after a touch, a resume, a window focus change or a resize, with the window state around it, so the rare "every button is dead" freeze leaves evidence.
Branch: `feat/screen-stall-telemetry` (worktree `autoreas-mobile-worktrees/screen-stall-telemetry`, cut from `main` at d2132b1 = v2.4.0). Delivery: local merge, `ask-on-risk`. Runner: `bun run test` (Jest), gate `npx lefthook run pre-commit`.

## Specs

- **S1 — Measure the screen, not the data path.** Agreed proposal (assistant, accepted by L2 "agregalos"): "avisar al Bridge cuando la pantalla deja de dibujarse por más de unos segundos, con hora de inicio y de fin"; "registrar los cambios de estado de la app (activa o en segundo plano) y de foco de la ventana"; "registrar si la app está a media pantalla". The probe re-mounts one invisible view and times the round trip from the JS commit to the native `onLayout`. It arms on events only (touch reaching JS, AppState change, Android `focus`/`blur`, window resize), never on a timer ([[prefer-events-over-loops]]).
- **S2 — Report only stalls.** A probe that takes >= 2000 ms becomes one `screen_stall` observation. Faster probes send nothing.
- **S3 — Wire contract (accepted unchanged by bridge-reports 2026-10-23; bridge branch feat/screen-stall-telemetry, version not assigned yet).** `kind: "screen_stall"`, `observation_id` (uuid), `observed_at_ms` (probe armed), `duration_ms` (2000..3600000), `trigger` (`touch|app_active|focus|resize`), `app_state` (`active|background|inactive|unknown`, at probe start), `window_focused` (bool|null), `window_width`/`window_height`/`screen_width`/`screen_height` (dp, > 0), `transitions` (0..8 of `{event: active|background|inactive|focus|blur|resize, at_ms}`, oldest first). Every key always present; nothing about animes.
- **S4 — Same door as chapter telemetry.** Stored in the existing diagnostics outbox and flushed by the existing flush. Muted when the user's diagnostics switch is off. Not enqueued until `screen_stall` is in `SYNC_DIAGNOSTICS_ACCEPTED_KINDS`, which happens only once the bridge ships it (a refused kind is destroyed on its first POST).
- **S5 — Never hurt the app.** A recorder or probe failure is swallowed. The probe view is invisible, takes no touches and no space, and never blocks the touch that triggered it.

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S2, S3, S4, S5 | inline | done: builder + recorder; 11 tests; mutants threshold/accepted-gate killed | this commit |
| T2 | S1, S5 | inline | done: hook + wrapper at the root; 13 tests; mutants re-arm/background/switch killed; full suite 2372/2372, lefthook green | this commit |
| T3 | S4 | inline | blocked: add `screen_stall` to SYNC_DIAGNOSTICS_ACCEPTED_KINDS once bridge-reports names the release (first after 2.3.1); 2.3.1 answers 400 `kind_not_served` | |

## Log

- L1 (2026-10-23, user): "Tengo un bug raro (raro de que no aparece siempre) que reportar. Trata de debugear con lo que tenemos de logs entre device y mcp. \"\"\"Entre las 12:25 y 12:27 los botones de acción como +, -, settings, poner nota, cambiar estado, cambiar de día, no reaccionaban. Sucedió después de abrir la app a media pantalla, la app estaba en segundo plano antes de abrirla de nuevo. No fue un abrir en frío. No tuve que salir, se arreglo solo después de varios minutos. Estaba conectado el computador con bridge.\"\"\""
- L2 (2026-10-23, user): "agregalos"
- L3: evidence. 00:25:38 tap received, committed, and sync ok within 1 s; no other tap reached JS until 00:27:22; the WS stayed open (AppState stayed active); no ANR. The logcat for the window was already rotated. Analysis in memory `dead-buttons-after-resume-2026-10-22`. The contract was sent to session autoreas-bridge-fc.
- L4: bridge session autoreas-bridge-fc declined the request (it is scoped to another task). The bridge side needs the owner. Note: tests were written after the code, not before; the five mutation checks stand in for RED.
- L5 (2026-10-23, bridge-reports): accepted the body unchanged. Validation: every key required, only `window_focused` nullable, dims 1..2147483647, ints only, transitions 0..8, order not validated. Retention 5000; shows in MCP search_history as phone_report `screen_stall`; duration >= 10000 opens incident `mobile_failure|screen_stall|<trigger>`. An undeclared key answers 400 `field_rejected`. The version comes with the first bridge release after 2.3.1. Mobile fix: a size under 1 dp rounded to 0, so it is now dropped before sending.
