# Home screen redesign
Objective: Bring the approved home-screen mockup (OpenDesign project "Design system Mobile", `home-redesign.html`) into the Expo app. Branch: feat/home-redesign (from dev); delivery: local merge, work-unit commits.
Checks: focused Jest suites per task, `npx lefthook run pre-commit`, react-doctor diff, device screenshots on the SM-X800 dev client (Metro). Runner: Jest (jest-expo).

## Specs
Quoted from the approved list (L1). Pending decisions in L1 are NOT specs.
- S1 (sync status block): "Quitar el bloque de estado que hoy está siempre visible sobre la lista (`AnimeListScreenStatusSection.tsx`)." Assumption: the list subtitle, the "Modo temporada" chip and the folder banner stay, as the list head (mockup `.list-head` keeps subtitle + season chip).
- S2 (sync button): "Agregar en la barra un botón de 44 pt con un punto del color del estado: Verde en "Al día". Azul en "Sincronizando" y "Por enviar". Ámbar en "Esperando a la PC". Rojo en "Envío rechazado". En "Sin Wi-Fi" y "Modo local", un icono en lugar del punto." Assumption: "Nada por enviar" (not in the mockup) gets a muted dot.
- S3 (breathing): "El punto "respira" mientras sincroniza (con Reanimated). Con "reducir movimiento" activado queda fijo." Mockup: 1200 ms ease-in-out alternate, opacity 1→0.3, scale 1→0.8.
- S4: "El mismo botón se usa en el teléfono y en la tablet."
- S5: "Las columnas laterales de la barra tienen ancho fijo (96 en el teléfono y 240 en la tablet), para que el estado nunca tape el título."
- S6 (sheet): "Nueva hoja "Sincronización": Al abrirla, muestra el estado una vez y una segunda línea solo si aporta algo. Debajo va la descripción. Las acciones ocupan todo el ancho y se reparten a partes iguales si hay dos."
- S7 (alert): "El `Alert` sobre la lista aparece solo con "Envío rechazado" y con "Esperando a la PC" tras 72 h. Va dentro de la columna de la lista, así que el panel de filtros no se mueve."
- S8 (docs): "Actualizar la invariante 5 de la skill `mobile-design-system` y `docs/design/`. Hoy dicen que el estado de sync nunca va en una hoja."
- S9 (tablet filters): "la columna recta pegada al borde pasa a ser un panel flotante. Tiene el mismo radio, superficie y margen que las cards. La selección es un relleno suave en acento, sin barra lateral. Hoy se marca con un punto azul. "Estrenos" va como título de su grupo. Si el contador es 0, se oculta en vez de mostrar "—"."
- S10 (phone rail): "Se mantiene un solo carril con los 10 filtros. Un separador "Estrenos" marca el cambio de grupo. El carril se desplaza solo hasta el filtro activo." Confirmed absent in `AnimeFilterRail` (no ref, no scrollTo).
- S11 (list container): "La lista se desplaza dentro de un contenedor con radio `--radius-card` y margen inferior de 16. Así las cards se recortan con esquina redondeada, no con corte recto."
- S12 (card info): "Los tres textos de la línea de datos van a 13px (`AnimeCardInfo.tsx:35`). La jerarquía queda solo en el color: el contador en `text-reading` y el estado y la nota en `text-muted`."
- S13 (action row): "El grupo del stepper nunca se encoge." The "Reanudar" width at 360 pt depends on Decision A (pending, not implemented).
- S14 (feedback): "No hay aviso ni "Deshacer" en ninguna acción cuyo resultado ya se ve en la card (capítulos, estado, nota). La respuesta va en la propia card: un pequeño salto en el contador y un pulso en el +." Plus haptics. Failure toasts stay (they report what the card cannot show).
- S15 (sheets): "Ninguna hoja lleva botón "Cerrar": se cierran tocando fuera, deslizando hacia abajo o con Escape."
- S16: "Mobile sigue mostrando la nota cuando hay `season`, sin comprobar el filtro." (no change; keep).

## Tasks
- T1 [S1-S7] Sync button in the bar (dot/icon, breathing, reduce-motion), fixed bar side columns, "Sincronización" sheet, alert gated to rejected/stale, status block replaced by the list head. Route: inline. Status: done (see L3). Commit: T1+T7 commit.
- T2 [S9,S10] Tablet floating filter panel; phone rail separator + auto-scroll to the active filter. Route: inline. Status: pending.
- T3 [S11] Rounded list container. Route: inline. Status: done with T1 (AnimeListScreenContent). Device check pending with a non-empty list.
- T4 [S12,S13] Card info line at 13px; stepper group shrink-0. Route: inline. Status: pending.
- T5 [S14] Counter bump + plus pulse + haptics on chapter change. Route: inline. Status: pending.
- T6 [S15,S16] Audit sheets for close buttons; confirm note visibility unchanged. Route: inline. Status: pending.
- T7 [S8] Invariant 5 in both skill copies + docs/design/patterns/states.md. Route: inline. Status: done (with T1). Commit: T1+T7 commit.

## Log
- L1 (2026-10-21): User request (pasted; verbatim excerpt of the approved list is quoted in Specs). Also pasted an OpenDesign handoff with "Target: React"; the app is Expo/React Native, so the redesign is implemented there, not as a separate React web app. Pending, NOT approved: Decision A (cover 80 / padding 12 under 380, icon-only "Reanudar"), broken image with `portada: null`, "-1 restantes", duplicated empty-state message, screen reader "Tocar para alternar" without `totalcap`, filter counter semantics.
- L2: Map (explorer): status block at `AnimeListScreenStatusSection.tsx`; sync copy from `src/features/sync/sync-visible-status.helpers.ts` (no state ids, tone only; "Por enviar" is `default`); header is native-stack `headerLeft/Right`; rail has no auto-scroll; stepper group lacks `shrink-0`; no haptics outside theme toggle; no reduce-motion usage; sheets: state, season rating, folder setup — none has "Cerrar".
- L3: T1+T7 done. Shared `SyncVisibleStatus` gains an additive `kind` (9 values) so the bar picks a glyph and the alert gate without matching copy; settings untouched. New `src/features/animes/ui/SyncStatusControl/` (button, dot, glyph, sheet, alert). `AnimeListScreenStatusSection` became `AnimeListScreenListHead` (alert only for `rejected`/`stale`, subtitle, season chip, folder banner) inside `AnimeListScreenListColumn`. Bar: native-stack header with fixed 96/240 side views and a custom title limited by `deriveHeaderLayout`. Also S11's rounded list container landed here (`AnimeListScreenContent`). Checks: tsc clean; staged eslint 0 warnings; 140 suites / 1340 tests in animes, sync, behaviour, settings, design, hooks; mutants (reduce-motion guard, stale alert gate) caught; react-doctor --diff no issues; device (SM-X800): green dot in bar, sheet opens with state + "Sincronizar ahora", tapping outside closes it. Not observed on device: breathing, amber/red states, alert (bridge state not forced).
