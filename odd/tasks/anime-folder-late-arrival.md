# Anime folder late arrival

Objective: find an anime's folder when it reaches the tablet after the anime itself, without walking the tree on a timer.
Branch: `fix/anime-card-layout` (same fix release as the card layout fix `21f5ed7`). Delivery: `ask-on-risk`, forecast ~300 authored lines. Test runner: Jest (`npx jest <path>`), gate `npx lefthook run pre-commit`.

## Specs

- **S1 — Problem (2026-10-16).** User: "Que hayan llegado los datos de bridge más rápido de lo que las carpetas en mobile se crean. Es más lo más probable es que pasó eso esta vez. Puesto que al crear un anime no necesariamente ya está creada la carpeta, esa se crea al descargar el primer capitulo, caso de season." Evidence: the folder index is built once per app process (`anime-folders.store.ts:80`); returning to the foreground only re-indexes a root that was lost (`store.ts:109`). A folder that appears on the SD while the app runs is never found until restart or "Volver a buscar".
- **S2 — Check on returning to the app.** User on option 1: "puede ser, es como el sync, no?". When the app returns to the foreground, check the pending animes (S4) the same way as S3.
- **S3 — Check on an incoming event of that anime.** User: "solo buscaría carpeta de los animes que no se ha encontrado carpeta antes, y solo en el momento de un nuevo evento de ese anime entrante, sin debounces ni delays ni nada de eso." An incoming event is a change of the anime's `last_applied_change_ms` (stamped by every remote apply). The check lists only the folder where the anime's folder is expected (one provider query per distinct parent, usually the root), not the whole tree. Only when a missing folder is found there does the index refresh.
- **S4 — Pending anime.** Active, has a bridge path (`folderRelative`), and resolves to no folder. Animes without a folder on the tablet (user: "hay anime que no tienen carpeta sincronizada directamente, como el caso actual de Date a Live") stay pending and cost one query per own event, nothing else.
- **S5 — Out of scope.** User rejected: re-checking on every sync or with a delay ("no podemos saber cuánto tiempo se puede demorar la carpeta en crearse en la tablet [...] puede llegar a ser demasiado costoso para el beneficio aparente"), showing the button for unresolved animes ("no, porque hay anime que no tienen carpeta sincronizada directamente"), and watching the SD ("No por lo mismo de 2"). Fallback stays "Volver a buscar" in Settings: "Si no, ya queda como reserva el botón de buscar folders de nuevo de configuraciones."

## Tasks

- [x] T1 — S3, S4: pure helpers: pending animes, expected parent of each, and whether a parent listing holds a missing folder. Route: inline. RED 9/9 failing (functions missing) → GREEN 95/95; MUTATE 5/6 killed, the surviving one (duplicate-key filter) was dead code and removed. Commit: this task's `feat(anime-folders)` commit.
- [ ] T2 — S2, S3: store probe (lists distinct parents, refreshes the index on a hit, shares in-flight work) and both triggers (foreground, per-anime event). Route: inline. Commit: —
- [ ] T3 — S1–S5: docs (`docs/anime-folders.md`), CHANGELOG `[Unreleased]`, device check on the tablet (available 2026-10-17). Route: inline. Commit: —

## Log

- **L1 — 2026-10-16, user (original request):** "Es verdad, esa es una posibilidad. Que hayan llegado los datos de bridge más rápido de lo que las carpetas en mobile se crean. Es más lo más probable es que pasó eso esta vez. Puesto que al crear un anime no necesariamente ya está creada la carpeta, esa se crea al descargar el primer capitulo, caso de season. En es caso, qué opciones tenemos?"
- **L2 — 2026-10-16, user:** "1. puede ser, es como el sync, no?. 2. puede ser, pero no podemos saber cuànto tiempo se puede demorar la carpeta en crearse en la tablet, es un factor multidimensional, puede llegar a ser demasiado costoso para el beneficio aparente. 3. no, porque hay anime que no tienen carpeta sincronizada directamente, como el caso actual de Date a Live. 4. No por lo mismo de 2. // Como le puedes mejorar la propuesta de 2?"
- **L3 — 2026-10-16, user (approved design):** "claro, te entiendo que solo buscaría carpeta de los animes que no se ha encontrado carpeta antes, y solo en el momento de un nuevo evento de ese anime entrante, sin debounces ni delays ni nada de eso. Sí, pienso que esto combinado con la 1 ya nos resuelve la mayorìa de casos. Si no, ya queda como reserva el botón de buscar folders de nuevo de configuraciones."
- **L4 — Context.** Ranma 1/2 (2024) 3rd Season, Ao Ashi Season 2nd and FX Senshi Kurumi-chan (created from Season at 2026-10-16 03:25Z) showed no folder button. bridge-folders confirmed they were served with `folder` in `changed_fields` and `folderRelative` set (changelog 2494–2496); mobile stores it (test in `21f5ed7`). From bridge dev `31910142`, creates arrive as `change_type: "create"`; mobile needs no change for that. Design: a hit triggers the existing full forced re-index (~0.3–0.5 s, measured in anime-folders L15), so the index is never patched by hand.
- **Next:** T1.
