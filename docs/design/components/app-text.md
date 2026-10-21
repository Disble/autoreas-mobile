# AppText

**Answer:** `AppText` is a 10-line wrapper over React Native `Text`. It merges the class
`font-normal` with the caller's `className` through `cn()` and forwards every other prop
unchanged. It adds no prop, no variant, no size and no accessibility behaviour of its own.

Source: `src/components/app-text.tsx` and `src/components/app-text.types.ts`.

> Back to the [design system README](../README.md) · [Primitives](heroui-native.md) ·
> [Typography](../foundations/typography.md).

## What it adds over React Native `Text`

| Aspect | Reality | Citation |
| --- | --- | --- |
| Prop contract | `AppTextProps = RNTextProps` — nothing added, removed or narrowed | `src/components/app-text.types.ts:4` |
| Only special prop | `className` is destructured out; everything else is spread onto `Text` | `src/components/app-text.tsx:7` |
| The added class | `cn('font-normal', className)` | `src/components/app-text.tsx:9` |
| The underlying element | React Native `Text`, imported as `RNText` | `src/components/app-text.tsx:2` |
| Default weight | `font-normal` resolves the `--font-normal` slot: `'Inter-Regular'` | `global.css:10` |

That is the whole wrapper. It is not a design-system component with its own variants — it is the
one place where app text gets a class string it can be merged into.

## The default `font-normal` and its consequence

The typography page declares four weight roles, each mapped to one family
([`font-normal` → `Inter-Regular`, `font-medium` → `Inter-Medium`, `font-semibold` →
`Inter-SemiBold`, `font-bold` → `Inter-Bold`](../foundations/typography.md)). `AppText`
supplies the **lightest** of the four on every render, and `cn()` resolves the conflict in
favour of the caller's class when both set a weight. So:

- a call site that names **no** weight class always renders **Regular 400**;
- a call site that names `font-medium`, `font-semibold` or `font-bold` **replaces** the
  default instead of stacking on it;
- nothing in the app can reach Medium/Semibold/Bold by inheritance — it has to be named at
  the call site.

Measured over the 65 `<AppText` occurrences in `src/`: **34 name no weight class**, 23 name
`font-semibold`, 5 name `font-medium`, 3 name `font-bold`, and none names `font-normal`
explicitly. Roughly half of app text therefore renders Regular, and the hierarchy on screen
comes from the size and colour classes the call site passes (for example
`text-sm font-semibold text-foreground` at
`src/features/settings/ui/SettingsScreen/SettingsBackgroundCard.tsx:37`) rather than from a
typographic scale inside the wrapper.

## Where it is used

19 files render it in 65 occurrences: 2 in `src/components/`, 3 in `src/features/anime-folders`,
8 in `src/features/animes`, 4 in `src/features/settings`, 2 in `src/features/setup`. It is not
universal — the startup boundary renders HeroUI `Typography` instead
(`src/features/startup/ui/StartupBoundary/StartupBoundaryLoading.tsx:17`), the battery-exemption
dialog renders `Dialog.Title`/`Dialog.Description`
(`src/features/battery-exemption/ui/BatteryExemptionPrompt/BatteryExemptionPrompt.tsx:30`), and
sheet titles use the sheet's own title slot
(`src/features/animes/ui/SeasonRatingSheet/SeasonRatingSheet.tsx:130`).

## What it does not do

- **No `maxFontSizeMultiplier`.** It is set once for the whole app through the HeroUI Native
  provider config at `src/features/startup/ui/StartupBoundary/startup-boundary.helpers.ts:404`,
  not by this wrapper.
- **No `allowFontScaling` handling**, no `accessibilityRole`, no `numberOfLines` default — a
  call site that needs them passes them (`numberOfLines={1}` at
  `src/features/anime-folders/ui/AnimeFoldersDetailScreen/AnimeFoldersDetailScreen.tsx:96`,
  `selectable` at `src/features/settings/ui/SettingsScreen/SettingsConnectionCard.tsx:12`).
  No `AppText` call site passes an `accessibility*` prop.
- **No size, colour or weight vocabulary.** It does not expose variants; the call site writes
  Tailwind classes.
- **No default family fallback.** It never names a font family directly; it depends on the
  `--font-*` slots in `global.css`.
- **No `accessibilityLabel` logic**, no truncation strategy and no link/button semantics.

## Evidence boundary

Read from the two files above plus `global.css`. The occurrence counts come from
`grep -rn '<AppText' src`, with the four multi-line call sites read by hand. This page makes
no claim about how any of it looks on a device.
