# Proposals and evidence

**Answer:** this repository has no automated check that renders a screen. So a design statement is
only as good as the evidence attached to it, and the three kinds of statement have to stay visibly
separate: **implemented and cited**, **approved but not implemented**, and **proposal or open
question**. A reviewer must be able to tell which one they are reading without asking.

> Back to the [design system README](../README.md) · Related: [States](../patterns/states.md) ·
> [Typography](../foundations/typography.md).

## The three labels

| Label | Means | Evidence it needs |
| --- | --- | --- |
| **Implemented and cited** | The code does this now | A `path:line` citation a reader can open, plus the command that shows it, when one exists |
| **Approved but not implemented** | A human chose it; the code does not do it yet | The decision, and the unit that will apply it — not a screenshot of the intended result |
| **Proposal or open question** | Nobody has decided | The question, the options, and what choosing one would cost |

Never let one label drift into another. A page that states an approved direction as present fact is
wrong even when the direction is right: that exact drift was caught in review here, where
`docs/design/` described semantic-only component colours as the current state while `src/` still
carried 18 literal-colour lines. The pages now state the rule and the measured count separately, and
that separation is the standard.

Prose that quotes a *decision* is not proof of the code; prose that quotes an *intention* is not a
decision. Cite the file, or name the decision and its open unit.

## Mockups and artifacts are reference views

Design artifacts for this project live under the private, untracked `.pi/mockups/` directory —
never in `src/`, never in a commit, never published. They are produced by a local generator (for
example `.pi/mockups/build-mobile-design-system.cjs`, which writes
`.pi/mockups/mobile-design-system.html`) or by the agent's `artifact` renderer, and they are shown to
the requester only.

What such a file is: **a reference view** — checked-in token values, declared font faces and
labelled sample surfaces, assembled in a browser to make a decision discussable.

What it is not: a native render. It is not React Native, not the installed HeroUI Native package, not
a device or simulator, not a screenshot, and not evidence of any screen's real appearance. Its
colours may be the real declared values and its appearance is still an HTML artifact's appearance.

Two consequences that have already bitten here:

- **An approved mockup is not an implemented change.** The Inter-only direction was approved while
  `global.css` still declared other families; the artifact marked the alignment as approved and not
  yet applied, and only the later unit that changed the files closed the gap. Keep that wording in
  the artifact instead of smoothing it into "the system uses Inter".
- **Rebuild or relabel an artifact when the decision changes.** An artifact that still shows
  discarded options is a proposal in the wrong tense; say it is stale or regenerate it, do not let
  it stand as a description of the app.

## An appearance claim needs an observation

Anything about how a screen *looks* — spacing, weight on screen, contrast, a colour in context, how
a state reads at a glance — needs a device or simulator observation, made by the person making the
claim. Nothing in this repository substitutes for it: not a docs page, not a contract test, not a
jsdom assertion, not `typecheck`, not a generated artifact, not a vendor's published description of
its own component. Where such a thing is all that exists, say what was read and say that appearance
was not observed.

This is a boundary, not an apology. It is also why honest work here is cheap to review: a change
that touches no appearance claim is fully verifiable by reading and running checks, and a change
that does make one says so, with the observation beside it.

## Cost is work size

When a proposal is priced for a decision, describe it as work size in plain terms: a label or
copy change; a wiring change that reuses an existing callback; a unit that needs new logic and its
tests; or a change to a contract that other surfaces depend on. Never invent a currency, a rate or a
dollar figure — the repository has no such scheme, and a made-up number is a proposal wearing a
measurement's clothes.

## Reviewer-visible separation

A change that mixes the three labels must make the split visible where a reviewer reads it:

1. Implemented items carry citations; run the check or read the line.
2. Approved-but-pending items are named as pending, with the unit that will apply them.
3. Open questions stay in a question, and do not appear in the same sentence as the present tense.
4. Anything an artifact shows is introduced as a reference view in the same place it is referenced.

Detail is in the pages that own it: [Color tokens](../foundations/color-tokens.md),
[Typography](../foundations/typography.md), [Primitives](../components/heroui-native.md),
[States](../patterns/states.md).
