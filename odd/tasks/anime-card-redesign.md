# Anime card redesign and rating flow

Objective: implement the redesigned anime card and its note sheet in the app, using the approved
prototype as the visual reference.

Branch: `feat/anime-card-redesign`, based on `feat/mobile-design-system-01-foundations` (which carries
the theme, typography and skill work this depends on and is **not integrated yet**). Delivery:
feature-branch chain, one reviewable unit per task. RDD: off. Forecast: 500–800 authored lines
including tests and docs.

References: `.pi/mockups/season-rating-workflow.html` (private, uncommitted, reference only);
`docs/design/proposals/anime-cards-and-season-rating.md`; current behaviour in
`docs/design/components/anime-card.md`.

## Specs

- S1 — Card type recipe, from the decision recorded in the proposals page (approved in an earlier
  session; no verbatim quote exists in this session): title 16px/400 in `foreground`; one meta line
  with the count at 13px/400, the state and the note at 11px/400 in `muted`; the count under the
  title; the decrease control neutral and the increase using the primary role; the star opens the note.
- S2 — Meta line composition, user verbatim: «contador, estado y nota en una misma linea»; the note
  label is `Nota`, from «aca abajo: nota en lugar de temporada» and «Solo "Nota"»; no separator may be
  left alone («no puede quedar solo»).
- S3 — State always present in the line, user verbatim: «el estado en pausa falta en la row». Labels
  come from the existing constants: `Viendo`, `Finalizado`, `No me gustó`, `En pausa`.
- S4 — Coloured state chips removed, user verbatim: «quiero quitar esos labels de colores para los
  estados de En pausa, Finalizado, etc.»
- S5 — Sheet shape, from the annotated captures: heading `Nota`; no subtitle with the anime title; no
  season selector; comparison shows only the two numbers with a prominent arrow; the action reads
  `Guardar` and appears only when the value differs; no close button — it closes from the scrim or
  with Escape and focus returns to the trigger.
- S6 — Secondary colour, user verbatim: «ciertamente, el ambar compite mucho con el azul y el
  warning, pienso que mejor el violeta» and «seria el color secundario». Violet becomes the
  **`secondary`** role and amber is rejected.
- S8 — Sync architecture, user verbatim: «El modo temporadas debe pasar por la misma arquitectura de
  sincronización que el modo anime. En el modo animes, nosotros no tenemos estados especiales dentro
  de las cards para indicar que un anime no pudo sincronizar. Para eso tenemos una sola card encima
  que se va actualizando. Nada de seasons, ni notas, ni nada de eso pasa por un workflow diferente.
  Sigue exactamente el mismo workflow de sincronización que el resto de animes que no están en modo
  temporada.» Consequence: no per-note sync state exists anywhere in the card or the sheet. The single
  status surface above the list (`AnimeListScreenStatusSection`) is the only place sync state is
  reported, and the note is queued like any other anime mutation.
- S9 — No separate season path, user verbatim: «Hemos pasado por muchas iteraciones para quitar el
  camino exclusivo de seasons, incluso la API que antes usaba ya no existe. Por favor, no vuelva a
  dividir las aguas separando seasons del resto de animes, seasons es parte de los animes!»
  Consequence: the note is a field on the anime, the sheet is the anime's sheet, and no task, doc or
  mockup may describe or build a season-only flow. Any wording that frames the note as a separate
  seasonal workflow is a defect, not a style preference.
- S7 — Model, described by the user and summarised here rather than quoted: every anime is born in a
  season; a season is the time range in which an anime first airs; season mode is a range inside it
  where the user evaluates what they will watch; one anime has one note and there is no season picker
  inside an anime. A later series season is a separate anime (`Date A Live V`).
- S10 — Card parity with the approved mockup, user verbatim: «necesito que le revises al rediseño
  aprobado y lo que se está mostrando actualmente en la app para que planifiques el ODD de refactor».
  The gaps below were read from `.pi/mockups/season-rating-workflow.html` (card markup and CSS) against
  the device capture of `Vistos` at b7d2a2c; each is a requirement only because the mockup draws it:
  - S10a — Stepper without a number: only `−` and `+`, 12 px apart; the `nrocapvisto` digit between them
    is removed, since the count already lives in the meta line.
  - S10b — Star in the left group: link, folder, star, then the spacer, then the stepper or `Reanudar`.
    The star is still rendered only for an anime with a note to give (`showRatingCta`).
  - S10c — One button recipe for the row: every icon button is a 40 pt box with a 20 pt icon on the
    `default` surface (touch target stays at 48 pt through `CARD_TOUCH_SLOP`); the star uses
    `accent-soft-foreground`; `+` keeps the accent fill. The mockup draws its own inline SVGs, not
    Ionicons, so its glyphs are not copied; instead, user verbatim: «cambia los todos los íconos de la
    card a outline version para mejor consistencia». Every card icon uses the Ionicons `-outline`
    variant: `link-outline`, `folder-outline`, `star-outline`, `remove-outline`, `add-outline`,
    `play-outline`, `ellipsis-horizontal-outline`. Done in the working tree, not committed.
  - S10d — Count emphasis: the count reads brighter than the state and the note (mockup role
    `--reading-count`: dark `oklch(0.86 0.012 286)`, light `oklch(0.37 0.0125 285.94)`), not `muted`.
  - S10e — Separator: a small round dot between segments (3 px, `currentColor` at 60 %), never a lone dot;
    S2's conditional rule still holds.
  - S10f — Deviation from the mockup, user verbatim: «manten lo de mostrar los episodio restantes,
    quita lo de abrir la hoja inferior al tocar la nota». The whole meta line keeps toggling the
    remaining episodes; the note is plain text with no underline and no press of its own; the star is
    the only way to the note sheet.
- S11 — Row gaps, user verbatim: «Percibo demasiado espaciado entre título, línea de contadores y línea de
  íconos. Usa un sistema de spacing y teoría de jerarquía (todo basado en las skills de design) para
  equilibrar esas row gaps.» Resolved by `docs/design/foundations/spacing.md`: 4 pt grid, tiers 4/8/12/16,
  a gap inside a group at most half the gap around it, and touch areas through slop, never a minimum box.
- S12 — Note sheet parity, user verbatim: «sí haz los cambios», answering the comparison of the device
  sheet with the approved mockup states (saved only, no note, and `3 → 5` with `Guardar`). Four changes:
  the track fills the **saved** note and rings the **draft** (it was inverted); the comparison is a plain
  13 pt line; no `Elige una nota` prompt or inner panel; one segmented track with muted digits instead of
  six separate blue-text buttons. The sheet's full width on a tablet is out of scope (the mockup does not
  define a tablet sheet).

## Tasks

One task is one reviewable unit with its own tests and, where behaviour changes, its own commit.

- T1 [S6] — The `secondary` role. Decide how the app resolves a theme colour in JS before declaring
  anything, then add the role for both modes, expose it through whatever path `useThemeColor` reads,
  document it in `docs/design/foundations/color-tokens.md`, name it in the skill (both mirrors), and
  add a contract test that fails if the role disappears from either mode. Status: done. Commit: e1e8b8e.
- T2 [S1,S2,S3,S4] — The card: one meta line with conditional separators and the state from the
  existing constants, the note labelled `Nota`, the coloured state chip removed, the ellipsis still
  wired to the existing `AnimeStateSheet`, plus its tests. Acceptance also covers the two defects the
  design review found in this surface: touch targets of at least 44 pt and no `nowrap` overflow of the
  meta line at narrow widths. Status: done. Commits: 4e81497 (unit), plus the completion unit mvgulxrx-3-9ge2.
- T3 [S5] — The sheet: heading `Nota`, no subtitle, no season selector, numeric comparison with the
  prominent arrow, the saved value in `accent` and the draft ring in `secondary`, values 1–6,
  `Guardar` only on change, no close button, backdrop close with focus return, plus its tests.
  Status: done. Commits: a38ca79 (unit mvgu2cgs-2-ljac) and c71073d (bridge summary removed).
- T4 [S7,S8] — Align the note with the shared sync architecture: delete the sheet's own sync states
  (`Pendiente de sync`, `Requiere reparación`, `Bridge confirmó`, the status alert, the builder, the copy
  and the two props that fed it), stop the list screen from computing and passing per-note status, and
  prove the note is queued through the same path as any other anime mutation. The single status card
  above the list stays untouched. Commit: —
- T5 — Verification and close: repository gate, lab APK on device with before/after screenshots,
  reconcile docs and skill. Commit: —
- T6 [S10a,S10b,S10c] — Actions row parity, inline: drop the digit from `AnimeCardChapterControls`
  (and the `nrocapvisto` prop down the chain if nothing else reads it), move the star before the spacer in
  `AnimeCardActions`, unify the 40/20 recipe (glyphs unchanged). Tests: star order and presence by
  `showRatingCta`, no count text in the row, `Reanudar` still replaces the stepper when locked. Status: done (RED 5/5, GREEN, mutation killed). Commit: see L21.
- T7 [S10d,S10e] — Meta line emphasis, inline: declare the count role per O5 (contract test like
  `tests/design/secondary-role.test.ts`, docs in `color-tokens.md`, both skill mirrors), apply it to the
  count span, and draw the dot separator. Tests: helpers still never emit a leading/trailing/double
  separator. Status: done (RED observed, mutation killed). Commit: see L23.
- T8 [S10f] — Dropped: the app already behaves as S10f asks, so there is no code change. T7 must keep
  it that way: the meta line stays one pressable with the remaining-episodes toggle, and the note gets
  no underline. Commit: none.
- T10 [S11] — Spacing tiers and the meta line: `min-h-11` box replaced by `META_TOGGLE_HIT_SLOP`, line at `leading-[18px]`, 4 pt under the title and 12 pt above the actions; spacing page, skill rule 2b (version 1.4). Inline. Commit: see L25.
- T11 [S12] — Note sheet track and comparison, inline: `buildSeasonRatingSegments` (saved, draft, idle), `SEASON_RATING_SEGMENT_PRESENTATION`, `RatingTrack`, plain comparison line, prompt copy removed. Commit: see L27.
- T12 [S11] — Cover no longer forces a minimum height (`min-h-36` removed), so a one-line card ends 16 pt under its actions. Inline. Commit: see L29.
- T13 [S11] — Paired cards share the grid row height; title group top, actions bottom (`justify-between`). Inline. Commit: see L31.
- T9 — Close: anime feature suite, `react-doctor --diff`, pre-commit gate, lab APK on the tablet with
  `Vistos` before/after next to the mockup, docs `docs/design/components/anime-card.md`. Status: done with two items unproven on device (L24). Commit: see L24.

## Open questions

- **O1 — `secondary` values.** The hue is decided; the exact light value is not. The dark prototype
  value is `oklch(0.62 0.19 300)`. T1 needs a light value; it will be proposed in the task and shown in
  the commit, not chosen silently.
- **O2 — resolved by S8, not by a UI choice.** There is no per-note sync state to design: the note is
  queued like any other anime mutation and the single status card above the list reports sync
  health. What the sheet keeps from this is only the ordinary mutation path: a failed local write
  throws and is recorded exactly as any other mutation, and the sheet does not grow a status block to
  narrate it. Earlier draft of this question, kept for the record:
  - **O2a, local intent.** Tapping `Guardar` inserts a local intent row. It can fail when SQLite is
    unavailable or the write errors; `useMutateAnime` throws and records the failure, so nothing is
    reverted silently today. Undecided: does the sheet stay open with an error, or close with the
    card unchanged? Recommendation: stay open, show the error inline, leave the card untouched —
    nothing was saved, and closing would imply it was.
  - **O2b, bridge confirmation.** The intent is already stored locally, so a rejection does not lose
    the note: it stays `pending` and becomes `failed` with an existing repair state
    (`SeasonRatingIntentStatus`, `SeasonRatingFailureKind`). Nothing new is needed; T4 only has to
    keep that visible instead of hiding it. This is also where the optimistic proposal actually
    bites: the card may show the new note before the bridge confirms it.
  The old O2a/O2b split is superseded: it assumed a per-note workflow that does not exist.
- **O3 — branch base.** Resolved: this feature branches from the unintegrated design-system branch.
  That stacks two features, so the design-system branch must be integrated or reviewed first.
- **O4 — meta line press.** Resolved by the user (L18, S10f): keep the remaining-episodes toggle, no
  note press.
- **O5 — count role.** Applied in T7 with the mockup's values (L23); reversible by editing two lines of `global.css`. The app has no lighter reading role (the current code says so). Proposal:
  add `reading` per mode with the mockup values, the same way `secondary` was added in T1. Not chosen
  silently; T7 shows it in the commit.

## Scope boundaries

In scope: the card, its meta line, the state chip removal, the note sheet, the `secondary` role.
Out of scope: the list, the filter rail, the responsive shell, season-mode logic, the state sheet's own
design, balance or data-model changes, and anything in `.pi/`.

## Verification

- Focused Jest per unit plus the existing suites that share the touched code; `bun run typecheck`;
  staged-file lint; the repository pre-commit gate on every commit.
- A lab APK built with `docker compose -f docker-compose.eas.yml run --rm eas-build lab`, installed
  with `adb install -r`, screenshots before and after. No appearance claim without it.
- Differential check on the card surface, since the list shares it.

## Risks

- Item 3: the card is a shared surface, so a wrong meta line or a removed chip reaches every list
  screen.
- Item 3 again for `secondary`: adding a role changes the documented contract and the skill.
- Two stacked branches, unintegrated.

## Log

- L1 — User request, verbatim: «Sí, y avanza hasta el T3.» This follows «seria el color secundario; con
  esto ya podriamos planificar el ODD».
- L2 — Decisions carried from the prototype session, quoted in the specs. The prototype work, its
  corrections and the device captures are recorded in `odd/tasks/mobile-design-system.md` L46–L59.
- L4 — T1 committed as e1e8b8e through the repository gate (quick: typecheck, fallow, lint; heavy:
  full suite and the staged mutation guard). Discovery that shaped it: `useThemeColor` only accepts
  the vendor colour names, so `secondary` cannot be read that way; the role is declared per mode and
  exposed as `--color-secondary` through `@theme inline`, with both halves guarded by
  `tests/design/secondary-role.test.ts`. The hue is the user’s; the light lightness is the parent’s
  proposal and is labelled as such in the commit, the docs and the skill.
- L5 — T2 unit returned complete for its surface: one meta line composed by pure helpers, state
  always present, note labelled `Nota`, coloured chip removed, ellipsis still opening the existing
  state sheet, and RED observed first (27 failing before the implementation). It left two acceptance
  items unmet because they live in files outside its surface: chapter buttons at `size-10` and the
  action buttons at `size="sm"` are under 44 pt, and a season candidate shows the note twice (meta
  line plus the season status row, whose description still says `Confirmado por bridge`). A
  completion unit (`mvgulxrx-3-9ge2`) owns the three extra files, the Spanish accessibility labels
  for the chapter buttons, and the documentation update.
- L6 — T3 unit returned complete: heading `Nota`, no subtitle, no season selector, numeric comparison
  with the saved value in `accent` and the draft ring in `secondary` read through
  `useCSSVariable`, `Guardar` rendered only while the draft differs and never disabled, footer close
  removed with the backdrop and `onAccessibilityEscape` as the exits, and RED observed first (19
  failing). Unproven and stated as such: focus restoration relies on the iOS modal-container teardown
  because the trigger ref lives in a file outside the surface; Android TalkBack restoration and the
  native reach of `onAccessibilityEscape` are unconfirmed. The `Candidato activo` chip and the bridge
  `n/6` line remain above the comparison, so a reviewer may see the note twice there too: a decision
  for the user, not a defect to fix silently.
- L7 — T2 and T3 committed through the repository gate: 4e81497 (card) and a38ca79 (sheet), each
  green on quick (typecheck, fallow, lint) and heavy (full suite plus the staged mutation guard).
  The full anime feature suite ran before committing: 30 suites, 332 tests, exit 0, so card, sheet
  and list screens coexist.
- L8 — Cleanup the parent did before committing, because the units left it behind: deleted
  `AnimeCardSeasonStatus.tsx` with its props and the two descriptor fields nothing rendered (fallow
  would have failed on them); centralised the hit-slop arithmetic as `CARD_TOUCH_SLOP` and
  `CARD_ELLIPSIS_TOUCH_SLOP` instead of six duplicated literals; corrected the two documentation
  sentences that still described the removed component.
- L9 — Open and blocking, each recorded above: O2 failure behaviour blocks T4; whether the sheet
  keeps the `Candidato activo` chip and the bridge `n/6` line above the comparison is the user’s
  call; focus return needs `AnimeListScreenSheets`, outside the surfaces used so far, so it is
  reasoned from the modal container and not proven.
- L10 — Sheet follow-up committed as c71073d: the `Candidato activo` chip and the bridge `n/6` block
  are removed with the view-model field, builder, copy and type that only they used. The comparison is
  the only place the note is drawn in the sheet; the pending, failed and confirmed copy stays because
  it describes sync state, not the note.
- L11 — O2 was restated after reading the write path, because the original question was too coarse:
  the note is written locally first and synced later, so `failure` means either a local insert
  failing (nothing saved, `useMutateAnime` throws and records it) or a bridge rejection (note kept,
  row becomes pending then failed with an existing repair state). See the two halves in Open
  questions; T4 stays blocked until both are decided.
- L12 — User corrected the architecture, verbatim in S8: season mode goes through the same sync
  workflow as anime mode, and no per-card or per-sheet sync states exist because one status card
  above the list reports it. Verified in code before accepting: `AnimeListScreenStatusSection` renders
  the only sync surface (`syncStatus` alert with its chip), and the sheet's pending/failed/confirmed
  copy plus `buildSeasonRatingSheetStatus` were exactly the divergent workflow the user rejected.
  T4 redefined accordingly; O2 is no longer a product question.
- L13 — User restated the rule that seasons belong to animes (S9) and forbade dividing the waters
  again. Parent realignment before any further code: the private prototype title and heading stopped
  framing the note as a season flow, the proposals page was retitled and reworded so the sheet is the
  anime's note sheet, its model section now states that seasons are a property of an anime and never a
  separate workflow, and the skill mirrors were checked for the same phrasing (no season wording
  remains there). Prototype regenerated: 936,820 bytes, zero external requests.
- L3 — Document restructured from eight specs and seven tasks to seven specs and five tasks: the
  test task was folded into each behaviour unit, and the two review-found defects became acceptance
  criteria instead of a task with no specification behind it.
- L14 — T4 closed by the parent after reviewing the worker's unit (mvgu1k2e-class work: the sheet's sync states are deleted and the note was traced to the same outbox, write door and flush entry point as a chapter change). Two violations the worker correctly reported but could not fix inside its surfaces were fixed here: the card rendered `Pendiente n/6` as the last per-card sync state (now `Nota n/6`/`Sin nota`, newest local choice over the bridge value), and the note submit awaited without a catch while its promise was discarded, so a failed write rejected unhandled and told the user nothing (now recorded and narrated with the same failure feedback a chapter change uses, with the sheet staying open because nothing was stored). Anime suite after both fixes: 30 suites, 336 tests, exit 0. Docs and both skill mirrors updated to state the rule as compliance rather than policy, version 1.2.
- L15 — T5 device verification, with the user driving the tablet to a list that has season candidates (Vistos). Verified on hardware, from the built APK at 061538b: the card reads `1 capítulo visto · Viendo · Nota 5/6` on one line with no coloured chip and no duplicated season row; tapping `Temporada` opens a sheet titled `Nota` with the 1-6 row and the saved value filled; choosing 3 shows `5 → 3` with the draft in the **secondary violet ring**, clearly distinct from the accent blue, and `Guardar` appears only then; confirming closes the sheet and updates the card to `Nota 3/6` immediately, while the single status card above the list moves to `Sincronizando · Enviando tus cambios a la PC` with `Revisar conexión`. That last observation is the architectural proof the spec wanted: the note entered the ordinary queue, and the only surface narrating it is the shared card.
  Two gaps seen on the device and not fixed: (a) the approved recipe reaches the note through a **star**, and the implemented card still shows the existing `Temporada` text button — the star was never added; (b) the shared status card repeats its own label (chip `Sincronizando` above title `Sincronizando`, previously `Nada para enviar` / `Nada por enviar`), which is pre-existing and outside this feature.
- L16 — Delivery slice boundary recorded, as the repository asks once a branch passes the review budget. `feat/anime-card-redesign` carries 17 commits and roughly 5,100 authored changed lines, which is past one reviewable slice. The feature keeps the agreed Feature Branch Chain: the branch is the tracker, and the review units are these slices, each green on its own gate run.
  - Slice 1, token foundation: e1e8b8e (secondary role).
  - Slice 2, card text layer: 4e81497 (one meta line, state, chip removal, 44 pt, Spanish labels).
  - Slice 3, note sheet: a38ca79 and c71073d (Nota, comparison, Guardar, no close button, bridge summary removed).
  - Slice 4, sync alignment: 061538b (sheet sync states deleted, note is a value, failure narrated like a chapter).
  - Slice 5, visual parity: 2b587d6 (16/13/11 scale), 57bba76 (star instead of the labelled button), and the neutral decrease control with its docs commit b7d2a2c.
  No slice is published; pushing, PRs and merging remain the user's decision.
- L17 — 2026-10-20, user request verbatim: «este mockup es para un rediseño de las anime cards, especificamenente para el estado de temporada. [...] necesito que le revises al rediseño aprobado y lo que se está mostrando actualmente en la app para que planifiques el ODD de refactor». Comparison done against the mockup source and the `Vistos` capture: six gaps recorded as S10a–S10f, planned as T6–T9 (all inline, Risk item 3 for the shared card surface, item 3 again for a new colour role). Already matching, no task: meta line text and order, ellipsis to the state sheet, `Reanudar` replacing the stepper, star hidden without a note, neutral `−` and accent `+`. Open: O4 blocks T8; O5 is a proposal inside T7.
- L18 — 2026-10-20, user decision verbatim: «manten lo de mostrar los episodio restantes, quita lo de abrir la hoja inferior al tocar la nota». O4 resolved, S10f rewritten as a deliberate deviation from the mockup, T8 dropped (current behaviour already matches). Remaining plan: T6, T7 (O5 still a proposal), T9.
- L19 — 2026-10-20, user verbatim: «los íconos revisales, porque no sé si el mockup tenía los íconos que se están usando en la app, si es de la misma librería entonces sí». Checked the mockup source: its nine icons are hand-drawn `<symbol>` SVGs with no library reference, not Ionicons. S10c amended: the glyph swap (outline folder) is removed and the app keeps its Ionicons; size, surface and star colour stay in scope.
- L20 — 2026-10-20, user verbatim: «sí, cambia los todos los íconos de la card a outline version para mejor consistencia». The «sí» answers the parent's question folder-outline vs folder-open-outline with the recommended closed `folder-outline`, matching the mockup. Seven glyph names swapped in `AnimeCardActions`, `AnimeCardChapterControls` and `AnimeCardStateBadge`; all seven exist in the installed Ionicons glyph map. No test renders these components, so there is no RED: typecheck (the `name` prop is typed against the glyph map), staged lint and the anime suite are the checks. Sizes and the star colour remain in T6.
- L21 — T6 done inline. RED: `tests/features/animes/anime-card-actions.test.tsx`, 5 of 5 failing on the old row (the no-number case passes the legacy `nrocapvisto` prop on purpose so it fails while the row draws it). GREEN: star moved into a left group with link and folder, stepper wrapped with `gap-3` and no digit, `nrocapvisto` removed from the actions, stepper and content props, every row icon at 20 pt, star in `accent-soft-foreground`. Mutation: star moved back next to the stepper on the staged file, 2 tests failed, restored with `git checkout --`. Checks: typecheck clean, react-doctor `--diff` no issues, anime suite 31 suites / 350 tests. Docs: `docs/design/components/anime-card.md` rows for the actions, stepper, star, icons and touch targets; it also dropped a stale claim of `#ffffff` literals the code no longer has.
- L22 — First T6 commit attempt rejected by the gate's lint job only (fallow, typecheck, test and mutation guard green): seven test constants without JSDoc, and `react-doctor/jsx-max-depth` on the new left group. Fixed by documenting the constants and extracting the group as `AnimeCardShortcuts.tsx` with `AnimeCardShortcutsProps` (`showNoteStar` instead of the whole season descriptor); the doc's line references moved with it.
- L23 — T7 done inline after the user's «commit y continua con el resto del plan». O5 applied as proposed: `--reading` declared per mode with the approved mockup values (light `oklch(0.37 0.0125 285.94)`, dark `oklch(0.86 0.012 286)`) and aliased as `--color-reading`; `secondary-role.test.ts` generalised to `app-declared-roles.test.ts` over both roles (RED: the three `reading` cases failed, `secondary` stayed green). Meta line: count in `text-reading`, drawn separator ` • ` (`META_DOT_SEPARATOR`) while the spoken label keeps ` · `, so screen readers hear the same string as before. New `tests/features/animes/anime-card-info.test.tsx` (RED 2 of 4; the other two pin S10f: one toggle, no note press). Seven expectations in `__tests__/AnimeCard.test.tsx` that pinned the old drawn dot and the muted count were updated, because those two things are exactly what S10d/S10e changed; the spoken-label expectations were left untouched. Mutation: count back to `text-muted`, 1 test failed, restored with `git checkout --`. Checks: typecheck clean, react-doctor `--diff` no issues, anime + design suites 35 suites / 379 tests. Docs: `color-tokens.md`, `anime-card.md`, both skill mirrors at version 1.3. Deviation recorded: the mockup draws the dot at 60 % opacity; the app draws it in the segment's `muted` colour, since nested RN text cannot take its own opacity.
- L24 — T9 on the tablet (R52T30686RV) with the lab APK built at f3f919a, `Vistos` open. Verified on hardware: every card icon is the outline variant (closed outline folder); link, folder and star form the left group; the stepper is `−` and `+` with no number; the count reads brighter than the muted state and note; segments are separated by the round dot; the star is drawn only on candidates. Not proven on the device: `Reanudar` (no paused anime in that list) and the remaining-episodes toggle (tapping the Ao Ashi meta line changed nothing visible, most likely because that anime has no total and so no remaining label; covered by `AnimeCard.test.tsx` and `anime-card-info.test.tsx`). Gate green on every commit (lint, typecheck, fallow, full suite, staged mutation guard). Nothing pushed or merged.
- L25 — 2026-10-20, T10 for S11. Cause measured on the device capture before changing anything: the meta line's `min-h-11` drew a 44 pt box around 18 pt of text, so the line sat ~50 px under the title and ~60 px over the actions, the same distance both ways, which reads as belonging to neither group. Fix: slop instead of size, title group 4 pt, groups 12 pt (1:3). RED 2 of 2 (the old `min-h-11` assertion in `AnimeCard.test.tsx` was rewritten to the new rule; the 44 pt requirement itself is kept and asserted as 18 pt + 26 pt of slop). Mutation: `min-h-11` restored on the staged file, 1 test failed, restored. Checks: anime + design suites 35 / 380, typecheck clean, react-doctor `--diff` no issues.
- L26 — T10 on the tablet with the lab APK at 3100b4a, `Vistos`: the meta line now sits right under the title and the actions row is clearly further away, so title and meta read as one group; the cards are shorter. Measured on the capture, glyph edge to glyph edge: title → meta about 14 px, meta → button top about 21 px. The drawn ratio is gentler than the 4:12 pt layout values because the text lines carry their own leading; recorded, not tuned, pending the user's look.
- L27 — 2026-10-20, T11 for S12. RED 8 (five segment-state cases, the prompt copy, the plain comparison, the one-track rendering). GREEN: the hook exposes `segments` instead of `ratingOptions`; the view draws `RatingTrack` with HeroUI `Button variant="ghost"` segments, the draft ring through the `border-secondary` class (no `useCSSVariable` left in the sheet). Mutation: the saved branch limited to an unchanged value, 1 test failed, restored. Checks: animes 32 suites / 361 tests, typecheck clean, lint clean after hoisting the per-state `accessibilityState` objects into the presentation constant, react-doctor `--diff` no issues. Docs: proposals page and `color-tokens.md`.
- L28 — T11 on the tablet with the lab APK at 751058b, Ao Ashi (saved 3): the sheet opens with `Nota` and one segmented track, 3 filled in `accent`, the rest muted, no prompt, no comparison, no `Guardar`, matching the approved "saved" state. Choosing 5 shows the plain line `3 → 5`, 3 still filled, 5 on the segment surface with the violet ring, and `Guardar` below, matching the approved draft state. Draft reset to 3 and the sheet closed from the backdrop: nothing saved, the card still reads `Nota 3/6`. Not seen on the device: the no-note state (every anime in that list has a note); covered by `buildSeasonRatingSegments(null, null)`. The sheet still spans the full tablet width, out of scope by S12.
- L29 — 2026-10-20, user verbatim: «en general ya está bien, solo me molesta ese espacio que queda debajo de los botones cuando solo hay una row de title, debemos mejorar ese spacing». Cause: the cover's `min-h-36` (144 pt) exceeded a one-line card's content (16 + 20 + 4 + 18 + 12 + 40 + 16 ≈ 126 pt), so 18 pt landed under the buttons; two-line cards exceed 144 pt and never showed it, which matches the capture. Fix: no minimum, the cover stretches to the text column (spacing page gained "Content sets the height"). RED 1 (`anime-card-cover.test.tsx`), GREEN, mutation (minimum restored, test failed, restored). Animes 33 suites / 362 tests.
- L30 — T12 on the tablet with the lab APK at 3b5c542: one-line cards (Ao Ashi, FX Senshi, Kyouran, Ranma, Seitokai, Tensei Ken) now end about as far under the actions row as the title sits under the card top (capture: ~24 px under the buttons against ~50 px before), and two-line cards are unchanged. No note was changed during the check.
- L31 — 2026-10-20, user verbatim: «pero ahora se ve raro el espaciado que queda entre tarjetas con diferentes niveles de alturas provocados por el titulo», then «consejo de frontend developer: usa la opción a, pero el título y la siguiente row agrupalas arriba, top, y la row de los botones agrupalos abajo, bottom. Así el espacio que te sobre es entre esos dos y no tienes que romperte la cabeza con redimensiones». Done: `grow` on `Card`/`Card.Body`, `justify-between` on the text column. RED 2, GREEN, mutation (`justify-between` removed, 1 failed, restored). Then the user: «por cierto, espero que cada update de UI no sea una prueba nueva sino actualización de las pruebas que ya debían existir del componente». The cover and layout cases moved into `AnimeCard.test.tsx` (no new file); its duplicated "free to wrap" case and the size/colour case already owned by `anime-card-info.test.tsx` were removed, the 11 pt and weight checks merged into the latter, shared helpers moved to `anime-card-test.helpers.ts` (554 → 475 lines). Rule recorded in AGENTS.md, CLAUDE.md, skill 1.5, learning log, engram. Animes 32 suites / 362 tests.
