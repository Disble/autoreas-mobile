# Proposals: anime cards and the season rating sheet

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
| Season sheet “option C” | Approved for iteration, not implemented | `.pi/mockups/season-rating-sheet-c-colors.html` |
| Optimistic season rating | Proposal, open question | Described below; no mockup implements it |
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

## Season rating sheet — approved direction

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
- `Guardar nota` appears only when the selected value differs from the saved one, and it is never
  shown in a disabled state.

## The rating model, as the app actually works

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
- **The optimistic rating is a proposal, not a decision.** The idea is that a season rating is
  applied immediately with no visible pending-confirmation state. Nobody has established what
  happens on failure: a silent rollback, a visible revert, or a queued retry. That question has
  to be answered before implementation, and it belongs in this page, not in a component.

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
