# Proposals: anime cards and the note sheet

This page records design work that is **approved but not implemented**, plus the questions
still open. It exists so the next redesign starts from a documented baseline instead of from
memory. Nothing here is in the app; the current card is described in
[the anime card page](../components/anime-card.md), and the three labels this repository uses
are defined in [proposals and evidence](../process/proposals-and-evidence.md).

> Back to the [design system overview](../README.md).

---

## Status at a glance

| Item | Label | Where the work lives |
| --- | --- | --- |
| Card structure “A · Lectura + Color” | Approved, not implemented | `.pi/mockups/anime-cards-*.html` (private, not committed) |
| Note sheet “option C” | Approved for iteration, not implemented | `.pi/mockups/season-rating-sheet-c-colors.html` |
| Optimistic note | Proposal, open question | Described below; the sheet carries no sync copy |
| Secondary hue for a draft rating | Open question | Undecided; see below |

The mockups are private HTML reference views, not native renders and not screenshots. They are
deliberately untracked: nobody reviewing this repository should treat them as shipped state.

## Card structure — approved baseline

The accepted direction is a reading-first card: the title carries the weight, the count sits
under it, and the secondary details recede. The agreed type sizes are part of the approval:

| Element | Size | Weight | Colour role |
| --- | --- | --- | --- |
| Title | 16px | 400 | `foreground` |
| Count, under the title | 13px | 400 | light gray |
| Details | 11px | 400 | `muted` |

Also approved in that direction:

- one count only, placed under the title;
- the details line keeps the state first and reads `Viendo · Nota 3/6`: the note label is **`Nota`**, not
  `Temporada`, and it stays on the same line as the state instead of moving to a line of its own;
- a card without a note reads `Viendo · Sin nota`, and a separator is never left without text beside it;
- the decrease control is neutral and the increase control uses the primary role;
- the rating is reached through a star affordance;
- no technical bridge wording on the card.

The current app still renders `Temporada n/6` (`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:108`),
so the rename to `Nota` is part of the proposal, not present behaviour.

These are **sizes and roles for a proposal**. They are not in the code, and the current card
does not use them.

## The note sheet — approved direction

Of the variants explored, only “option C” was kept for iteration: when a saved rating and a new
one differ, the sheet shows both so the change is visible before it is committed. The latest
exploration coloured the saved rating with the primary role and the draft with a secondary one.

Further decisions taken on that sheet:

- the sheet does **not** repeat the anime title under its heading;
- the comparison shows only the two numbers with a more prominent arrow (`3 → 5`), not the words
  `Guardada` and `Nueva`; those words stay available to assistive technology instead of being
  dropped;
- there is no season selector, no helper line about unchanged values, and no explanation of the
  failure case inside the sheet;
- the sheet heading is `Calificar nota`, not `Calificar temporada`;
- the sheet has **no close button**: it closes from the scrim or with Escape, and focus returns to
  the control that opened it;
- the sheet does **not** repeat the note the bridge already knows: the `Candidato activo` chip and the
  bridge `n/6` block are removed, so the note appears once, in the comparison;
- `Guardar` appears only when the selected value differs from the saved one, and it is never
  shown in a disabled state;
- the sheet carries **no sync copy**: no `Pendiente de sync`, no `Requiere reparación`, no
  `Bridge confirmó esta nota`, and no status alert. Sync health is reported once, by the single
  status card above the list
  (`src/features/animes/ui/AnimeListScreen/AnimeListScreenStatusSection.tsx`), exactly as it is for a
  card. The rule and its citations are in
  [loading, empty and error states](../patterns/states.md).

## The rating model, as the app actually works

**Seasons are a property of an anime, never a separate workflow.** The note is a field on the
anime, the sheet is the anime's sheet, and the write follows the same queue as a chapter change.
Nothing in a card, a sheet or a spec may introduce a season-only path: the single sync status above
the list reports sync health for all of it.


One anime has **one season candidacy and one rating**. `anime.season` carries `{ seasonId, grade }`, and
local intents are looked up by `animeId` plus `seasonId`, so a card can never hold several ratings to
choose between (`src/features/animes/anime-season.helpers.ts:14`-`:27`, `:47`-`:60`). The sheet opens with
the anime id and rates that one candidacy (`src/features/animes/ui/SeasonRatingSheet/`).

**A later season of the same series is a separate anime**, not a second season inside one entry: the app
would hold *Date a Live* and *Date a Live V* as two records. User, verbatim: «no tenemos este concepto de
temporadas en un mismo anime, así que esta UI no puede existir. Por más contexto, cada temporada se la ve
como un anime nuevo, ejemplo, Date a Live V».

Consequence for any mockup or prototype: a season picker inside a card or sheet contradicts the data model
and must not be drawn, not even as an assumption. An earlier private prototype did exactly that and was
corrected because of this note.

## Open questions

- **The secondary hue is decided: violet.** Amber was rejected because it competes with the
  primary blue and reuses `--warning`; the neutral ring (white in dark) was rejected as unconvincing.
  User, verbatim: «ciertamente, el ambar compite mucho con el azul y el warning, pienso que mejor el
  violeta». Violet has **no token yet**, so implementation needs a decision on its name and on one
  value per mode; `oklch(0.62 0.19 300)` is the prototype value, not an approved token.
- **The optimistic note is a proposal, not a decision.** The idea is that the note is
  applied immediately with no visible pending-confirmation state. This is settled for the sheet
  itself: it carries no sync copy at all, so there is no per-note pending state to design there.
  What stays open is the failure path — a failed local insert throws and is narrated nowhere
  today, and a bridge rejection has to be read from the shared status card. Who surfaces that, and
  how, is still undecided and belongs in this page, not in a component.

## What a redesign must not do

- Do not present any mockup, size or colour in this page as current behaviour.
- Do not change a card value that the current card page documents without updating both pages.
- Do not invent the secondary hue, the failure behaviour, or a bridge label to fill a gap.
- Do not claim rendering: the mockups are reference views, and no device comparison of a
  proposed card exists.

## Evidence boundary

Everything in this page is a record of design decisions taken in conversation, with the
mockups listed as the artifacts produced. No code implements these decisions, so there is
nothing to cite as implemented behaviour, and no appearance claim is made about any of them.
