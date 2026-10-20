# Mobile design system

The app ships **one base theme with two modes: `light` and `dark`**. Both modes are
declared in `global.css`, and the vendor theme (`heroui-native/styles`) supplies the
color values underneath them. There is no theme picker, no theme persistence and no
second palette: `ThemeName` is `'light' | 'dark'`, and the only control in the UI
toggles between those two.

Everything on this page describes the **checked-in static contract**. Nothing here is
proof of rendered appearance, Native compilation, contrast, or device output.

> Back to the [README](../../README.md) · Foundations: [Color tokens](foundations/color-tokens.md) ·
> [Typography](foundations/typography.md).
> Components: [HeroUI Native primitives](components/heroui-native.md) · [AppText](components/app-text.md) ·
> [Anime card](components/anime-card.md) ·
> Patterns: [Loading, empty and error states](patterns/states.md) · [Responsive layout](patterns/layout.md) ·
> Process: [Proposals and evidence](process/proposals-and-evidence.md) · [Open proposals](proposals/anime-cards-and-season-rating.md).
> Rule layer for agents: [`.agents/skills/mobile-design-system/SKILL.md`](../../.agents/skills/mobile-design-system/SKILL.md).

---

## Quick path

1. Use **semantic color roles** in component classes (`bg-surface`, `text-muted`,
   `border-border`), never a raw hue or a literal color value.
2. To change a token, override the role variable in `global.css` — see
   [How to change a token](#how-to-change-a-token).
3. Run `bun run typecheck` plus the focused tests for the area you touched. Neither one
   proves rendering, Native compilation output, or how either mode looks on a device.

## Where tokens live

| Owner | Declares | File |
| --- | --- | --- |
| `heroui-native` (vendor) | `light`/`dark` role values, the primitives behind them, and the `--color-*` aliases components consume | `heroui-native/styles`, imported by `global.css` |
| App | The overrides it actually wants in each mode — today the `--font-*` aliases and `--radius` | `global.css`, `@layer theme` |

`global.css` is the only entry point: it imports Tailwind, Uniwind and
`heroui-native/styles`, then declares `@layer theme { :root { @variant light … @variant dark … } }`.
Because the app block is declared after the vendor import, its declarations win for the
roles it names. Every role it does *not* name keeps the vendor value.

`metro.config.js` registers that entry point with Uniwind (`cssEntryFile` and
`dtsFile` only). `uniwind-types.d.ts` is generated from it and lists exactly
`['light', 'dark']`; do not hand-edit it as a source of truth.

Theme state in code: `src/contexts/app-theme-context/` exposes `ThemeName`,
`THEME_TOGGLE_MAP` (`light` → `dark`, `dark` → `light`), and `useAppTheme()` with
`currentTheme`, `isLight`, `isDark`, `setTheme` and `toggleTheme`. `ThemeToggle` is the
only consumer that changes the theme.

## The one UI rule

**Rule — for new and refactored UI.** A component asks for a semantic role
(`background`, `surface`, `muted`, `accent`, `danger`, `border`), not for a color. That is
what lets one token change reach every screen and keep both modes coherent.

**Current state — the repository does not satisfy that rule yet.** A literal-color grep
over `src/` returns **18 lines**: 12 SVG paint props in
`src/components/cover-placeholder-scene.tsx`, 5 Ionicons `color` props (for example
`color="#6366f1"` in `src/features/setup/ui/SetupScreen/SetupScreen.tsx` and
`color="#ffffff"` in `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx`),
and 1 `className="text-white"` in `SetupScreen.tsx`. Ionicons `color` and the SVG
`fill`/`stroke`/`stopColor` props take a raw color, so no class can replace them in
place. Recount with:

```bash
grep -rn "#[0-9a-fA-F]\{6\}\|text-white\|bg-white" src
```

| Do | Do not |
| --- | --- |
| `className="bg-surface text-foreground"` | `className="bg-white"` |
| `className="text-muted"` | `className="text-gray-500"` |
| `className="border-border"` | An inline `color` literal |
| `--danger` override in `global.css` | A `danger` hex duplicated per screen |

Raw React Native controls and `StyleSheet.create()` are out of scope for new or
refactored UI; use HeroUI Native primitives with Tailwind classes.

## How to change a token

1. Find the role you want in [Color tokens](foundations/color-tokens.md).
2. Declare the base variable for that role inside the matching `@variant` block in
   `global.css` (`light` and/or `dark`). Override the base variable (for example
   `--accent`), not the derived `--color-accent` alias.
3. Keep both modes covered when the change is not mode-specific.
4. Run `bun run typecheck` and the focused tests for any screen you touched.
5. Re-read the change on a device or simulator yourself — this repository has no
   automated visual or contrast check.

`--radius` and the `--font-*` aliases follow the same mechanism. The `--font-*` values are the four
Inter faces documented in [Typography](foundations/typography.md); `--radius` is still owned by the
shape work, not by this page.

## Existing but unwired file

`themes/alpha.css` exists in the repository and is **not imported** by `global.css`, so
it is not an active mode and it declares nothing the app compiles today. This page
records that fact only.

## Files in this directory

- [Color tokens](foundations/color-tokens.md) — the semantic role vocabulary the app
  consumes, per-mode ownership, and what is not documented or enforced yet.
- [Typography](foundations/typography.md) — the four Inter weight roles, where the faces are loaded
  and declared, and the executable contract that keeps `--font-*` on shipped PostScript names.
- [HeroUI Native primitives](components/heroui-native.md) — the 14 components the app renders,
  the repository rules that hold today, and where the code does not follow them.
- [AppText](components/app-text.md) — what the text wrapper adds over React Native `Text`, and
  what its default `font-normal` means for the four declared weights.
- [Anime card](components/anime-card.md) — the current `AnimeCard` part by part, with citations, as the
  baseline a replacement is compared against.
- [Loading, empty and error states](patterns/states.md) — the states that exist, each with its
  real trigger and component, plus the ones that do not exist at all.
- [Responsive layout](patterns/layout.md) — the three layout modes, the code constants behind them,
  and how the two-pane anime list shell is composed today.
- [Proposals and evidence](process/proposals-and-evidence.md) — how a proposal, an approved but
  unimplemented direction and an implemented change stay visibly separate, and why a mockup or
  artifact is a reference view rather than a render.
- [Open proposals](proposals/anime-cards-and-season-rating.md) — the approved card structure, the
  approved season sheet direction, and the questions still undecided.

Two more files are part of the system without being documentation: the project skill
`.agents/skills/mobile-design-system/SKILL.md` (mirrored byte-for-byte under `.claude/skills/`) holds
only the rules every UI change must know, and `tests/design/skill-contract.test.ts` fails when the two
copies diverge or when a `docs/design/` path the skill names stops existing.

## Checklist before merging a token change

- [ ] The change uses a semantic role, not a literal color, in component code.
- [ ] Both `light` and `dark` were considered.
- [ ] `global.css` still declares `heroui-native/styles` before the app overrides.
- [ ] `bun run typecheck` passes.
- [ ] Anything visual you claim was checked by you on a device, not inferred here.

## Evidence boundary

- Docs and static configuration only. No automated check reads palette values, resolves
  `var()` references, measures contrast, or renders a mode.
- The component and pattern pages **document the code as it is**, not a specification the code
  is guaranteed to satisfy. Where a convention is followed only in some places, the page states
  the measured count instead of presenting the convention as true.
- The `--font-*` aliases are a typography concern, documented in
  [Typography](foundations/typography.md). This page makes no claim about which font file wins at
  runtime.
- No screenshot, device, simulator or Native-compilation claim is made or implied by
  anything in `docs/design/`.
- A claim about appearance needs an observation on a device or simulator, made by whoever makes the
  claim. No page here, no test and no design artifact substitutes for it — see
  [Proposals and evidence](process/proposals-and-evidence.md).
