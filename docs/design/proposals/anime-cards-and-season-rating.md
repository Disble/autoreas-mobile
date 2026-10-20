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
- the decrease control is neutral and the increase control uses the primary role;
- the rating is reached through a star affordance;
- no technical bridge wording on the card.

These are **sizes and roles for a proposal**. They are not in the code, and the current card
does not use them.

## Season rating sheet — approved direction

Of the variants explored, only “option C” was kept for iteration: when a saved rating and a new
one differ, the sheet shows both so the change is visible before it is committed. The latest
exploration coloured the saved rating with the primary role and the draft with a secondary one.

## Open questions

- **The secondary hue is undecided.** No colour has been chosen for a draft value, and none may
  be assumed from a mockup. Any implementation needs that decision recorded here first.
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
