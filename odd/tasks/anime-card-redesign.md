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
- S7 — Model, described by the user and summarised here rather than quoted: every anime is born in a
  season; a season is the time range in which an anime first airs; season mode is a range inside it
  where the user evaluates what they will watch; one anime has one note and there is no season picker
  inside an anime. A later series season is a separate anime (`Date A Live V`).

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
  meta line at narrow widths. Status: in progress (mvgu1k2e-1-ym2x). Commit: —
- T3 [S5] — The sheet: heading `Nota`, no subtitle, no season selector, numeric comparison with the
  prominent arrow, the saved value in `accent` and the draft ring in `secondary`, values 1–6,
  `Guardar` only on change, no close button, backdrop close with focus return, plus its tests.
  Status: in progress (mvgu2cgs-2-ljac). Commit: —
- T4 [S7] — Connect the sheet to the real mutation path and implement the chosen failure behaviour
  (O2), with tests. Blocked until O2 is decided. Commit: —
- T5 — Verification and close: repository gate, lab APK on device with before/after screenshots,
  reconcile docs and skill. Commit: —

## Open questions

- **O1 — `secondary` values.** The hue is decided; the exact light value is not. The dark prototype
  value is `oklch(0.62 0.19 300)`. T1 needs a light value; it will be proposed in the task and shown in
  the commit, not chosen silently.
- **O2 — failure behaviour.** Silent revert, visible revert, or queue and retry. Blocks T4.
- **O3 — branch base.** Resolved: this feature branches from the unintegrated design-system branch.
  That stacks two features, so the design-system branch must be integrated or reviewed first.

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
- L3 — Document restructured from eight specs and seven tasks to seven specs and five tasks: the
  test task was folded into each behaviour unit, and the two review-found defects became acceptance
  criteria instead of a task with no specification behind it.
