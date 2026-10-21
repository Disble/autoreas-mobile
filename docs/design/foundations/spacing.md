# Spacing and grouping

**Answer:** spacing sits on a 4 pt grid (Tailwind's `1` = 4 pt) and is chosen by relationship, not by
eye. Things that belong together sit closer than the groups around them, and a touch area never
adds drawn space. The anime card is the first surface written to this rule; other screens have not
been audited against it.

> Back to the [design system README](../README.md) · [Typography](typography.md) ·
> [Anime card](../components/anime-card.md) · [Responsive layout](../patterns/layout.md).

## The four tiers

| Tier | Value | Class | Use |
| --- | --- | --- | --- |
| Inside a group | 4 pt | `mt-1`, `gap-1` | Lines that are read as one unit: a title and its meta line |
| Between siblings in a row | 8 pt | `gap-2` | Controls of the same kind side by side: the card's icon buttons |
| Between groups | 12 pt | `gap-3` | Two groups in one container: the card's text group and its actions row |
| Container edge | 16 pt | `p-4` | Inner padding of a card or panel |

A value off these four needs a reason written next to it. The stepper's `gap-3` is one: it separates
two buttons with opposite meanings (`−` and `+`) more than neighbours of the same kind.

## The grouping rule

Proximity carries the hierarchy, so it must not contradict it:

- **A gap inside a group is at most half the gap that separates that group from the next.** On the
  card that is 4 pt (title → meta line) against 12 pt (text group → actions row), a 1:3 ratio.
- **Equal gaps say "equal relationship".** If an element sits as far from the line above as from the
  row below, it reads as belonging to neither. That was the card's defect before this rule.

## Touch areas never add drawn space

A target smaller than 44 pt reaches 44 pt through `hitSlop`, not through `min-h-11`, `min-w-11` or
padding. A minimum height grows the box that lays out, and the invisible part becomes visible
spacing around the text. The slop must stop at the next interactive element, so split it unevenly
when one side faces a control and the other does not.

Applied on the card: the 18 pt meta line (`leading-[18px]`) carries
`META_TOGGLE_HIT_SLOP = { top: 14, bottom: 12 }`, 26 pt that makes 44
(`src/features/animes/ui/AnimeCard/anime-card.constants.ts`). The bottom 12 pt stops where the
actions row begins; the top 14 pt lies over the title, which is not pressable.

## Content sets the height

A container's height comes from its content plus its edge padding. A sibling that only decorates,
such as the card cover, stretches to that height and never imposes a minimum: on the card a 144 pt
cover minimum was taller than a one-line card's content (about 126 pt), so the extra 18 pt showed up
as an empty strip under the actions row and the bottom edge no longer matched the top. The cover now
crops to whatever height the text column sets.

## Evidence boundary

The tiers and the rule are a convention recorded on 2026-10-20 at the user's request to balance the
card's row gaps. The card's before and after were observed on the tablet; no other screen has been
checked against this page, and nothing here measures rendered pixels.
