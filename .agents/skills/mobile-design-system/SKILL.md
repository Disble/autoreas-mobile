---
name: mobile-design-system
description: "Trigger: design system, UI, token, color, colour, typography, theme, component, style, restyle, mockup. Use before changing UI in autoreas-mobile; the rules here, the detail in docs/design/."
metadata:
  author: autoreas-mobile
  version: "1.0"
  scope: project
  updates: living
---

# autoreas-mobile — design system rules

Before you touch a screen: find the rule below that your change touches, open the `docs/design/`
page it names (paths are repository-relative), and make the change there — not in an invented
component and not only in a comment. One base theme, two modes, one font family.

This file holds only what every UI change must know. The pages hold the detail, the citations and
the evidence boundary. When code and a page disagree, the code wins; fix the page in the same change.

## Invariants

### 1. Semantic roles, never a color

New and refactored UI names a role — `bg-surface`, `text-foreground`, `text-muted`,
`border-border`, `accent`, `danger` — and never a hex, `text-white`, or a per-screen duplicate. The
role's value lives in `global.css` or the vendor theme, never in the component.

**That is policy, not compliance.** `src/` still has 18 literal-color lines: 12 SVG paint props, 5
Ionicons `color` props, 1 `text-white` class. Ionicons `color` and SVG `fill`/`stroke`/`stopColor`
take a raw value, so a class cannot replace them in place. Do not copy those lines into new code and
do not "fix" them by inventing a token. Counts, recount command and role ownership:
`docs/design/README.md`, `docs/design/foundations/color-tokens.md`.

### 2. Four Inter weight roles, one name per role

`font-normal`, `font-medium`, `font-semibold`, `font-bold` resolve `Inter-Regular`, `Inter-Medium`,
`Inter-SemiBold`, `Inter-Bold`. The PostScript name *is* the identity: the `useFonts` key, the
`--font-*` value and any native `fontFamily` use that one string. Never pass a vendor export name
(`Inter_400Regular`) as a family, and never invent a second family — Inter is all the app ships.
`AppText` supplies `font-normal` by default, so a heavier weight is named at the call site.
Detail: `docs/design/foundations/typography.md`, `docs/design/components/app-text.md`.

### 3. `.tsx` is dumb UI

A `.tsx` file holds JSX, HeroUI Native primitives, and Tailwind classes merged through `cn()`.
No `useEffect`, no query, no database, no formatting: that is a `use-*.ts` hook beside the
component, and `src/app/**` only composes routes. `StyleSheet.create()` appears zero times here and
stays that way.

### 4. HeroUI Native first

Reach for the primitive instead of hand-rolling a control: `Button` + `Button.Label`, `Card` +
`Card.Body`, `Chip` + `Chip.Label` (`size="sm" variant="secondary"` is the common pair), `Alert` +
`Alert.Indicator`/`Content`, `BottomSheet`, `Dialog`, `Spinner`, `TextField`/`Label`/`Input`,
`Separator`, `Switch`, `Surface`, `Typography`. `Card.Footer`, `Dialog.Trigger` and
`BottomSheet.Trigger` are rendered nowhere in this app — check before you assume otherwise.
Inventory: `docs/design/components/heroui-native.md`.

### 5. The states that exist, and the ones that do not

Exists: a startup loading card (`Card` + `Spinner` + copy, gaining a slow-start notice), a
SQLite-unavailable screen, a startup failure card with recovery actions, one anime-list empty state,
one shared sync-status model (banner and settings card), a danger toast, an inline danger `Alert`, an
`Alert` inside a sheet, and blocking dialogs whose overlay, drag and close all mean "no".

Does not exist, so do not cite it as a pattern: no skeleton component, no `ActivityIndicator`, no
React error boundary, no first-load spinner for the anime list, no retry inside the empty state, no
dedicated offline screen. `Spinner` is the only indeterminate indicator.
Detail: `docs/design/patterns/states.md`.

## Before you change UI

- [ ] Name the role and the weight you are using. If a value must be new, declare it in `global.css`
      for both `light` and `dark` first, then read `docs/design/foundations/color-tokens.md`.
- [ ] Confirm the primitive you picked is one this app renders, or say in the change that it is new.
- [ ] Keep logic out of `.tsx`, and keep every file at or below 500 lines.
- [ ] Say which state you added or changed, including the provably absent ones you did not add.
- [ ] Claim no appearance. Nothing in this repository verifies rendering, so an appearance claim
      needs your own device or simulator observation —
      `docs/design/process/proposals-and-evidence.md`.
- [ ] Label your change as implemented and cited, approved but not implemented, or proposal and open
      question. A mockup or artifact is a reference view, never an implemented change.

## Keeping this alive

1. A new convention goes into `docs/design/` first, with its evidence, and only then here.
2. Add a line here only if every UI change must know it; otherwise link the page.
3. Keep `.agents/skills/mobile-design-system/SKILL.md` and
   `.claude/skills/mobile-design-system/SKILL.md` byte-identical — `cmp` them, do not re-type them.
4. Bump `metadata.version` whenever this rule layer changes.
5. Keep `tests/design/skill-contract.test.ts` green: it fails when the two copies diverge or when a
   `docs/design/` path named here stops existing.

## Reference

- `docs/design/README.md` — the index, token ownership, and where the app is behind its own rules.
- `docs/design/foundations/color-tokens.md` — the role vocabulary and what owns each value.
- `docs/design/foundations/typography.md` — the four weight roles and the one-name contract.
- `docs/design/components/heroui-native.md` — the primitives that are actually rendered.
- `docs/design/components/app-text.md` — the text wrapper and its default weight.
- `docs/design/patterns/states.md` — every state that exists, with its trigger and component.
- `docs/design/process/proposals-and-evidence.md` — proposals versus implemented state.
- `docs/design/proposals/anime-cards-and-season-rating.md` — approved but unimplemented card and sheet work, and the open questions.
