# HeroUI Native primitives in this app

**Answer:** the app renders **14 component exports** from `heroui-native`, and three of them —
`Button`, `Card`, `Chip` — carry nearly every screen. `Dialog`, `BottomSheet`, `Spinner`,
`Surface`, `TextField`, `Label`, `Input`, `Separator`, `Switch` and `Typography` each appear in
one or a few flows. This page records what the code imports and renders today. It states no
size, spacing, radius, colour or appearance value as guidance.

> Back to the [design system README](../README.md) · [AppText](app-text.md) ·
> [States](../patterns/states.md).

## Inventory

"Rendered in" counts the `.tsx` files under `src/` that render that primitive.

| Primitive | Rendered in | What this app uses it for | Cited example |
| --- | --- | --- | --- |
| `Button` | 17 files | Every action: confirm, cancel, retry, refresh, save, chapter `±` | `src/features/startup/ui/StartupBoundary/StartupBoundaryFallback.tsx:67` |
| `Card` | 10 files | Screen-level containers and the anime list-item shell | `src/features/animes/ui/AnimeCard/AnimeCard.tsx:41` |
| `Chip` | 7 files | Compact state and status labels; 6 use `size="sm" variant="secondary"`, the filter rail uses `size="md"` with `primary`/`tertiary` (`src/features/animes/ui/AnimeFilterRail/AnimeFilterRail.tsx:34`) | `src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx:33` |
| `Alert` | 8 files | Persistent inline status and error blocks, colour chosen by `status` | `src/features/animes/ui/AnimeListScreen/AnimeListScreenStatusSection.tsx:28` |
| `BottomSheet` | 3 files | Panels opened from a screen action: state choice, folder setup, season rating | `src/features/animes/ui/SeasonRatingSheet/SeasonRatingSheet.tsx:184` |
| `Spinner` | 3 files | Indeterminate loading while a payload or the database is not ready | `src/features/startup/ui/StartupBoundary/StartupBoundaryLoading.tsx:16` |
| `Dialog` | 2 files | Blocking decisions rendered without a trigger (reset, battery exemption) | `src/features/battery-exemption/ui/BatteryExemptionPrompt/BatteryExemptionPrompt.tsx:47` |
| `Surface` | 2 files | Rounded icon badges behind a single Ionicons glyph | `src/components/sqlite-unavailable-screen.tsx:10` |
| `TextField` + `Label` + `Input` | 1 file | The manual Bridge pairing form | `src/features/setup/ui/SetupScreen/SetupScreen.tsx:60` |
| `Separator` | 1 file | Divider between pairing-form sections | `src/features/setup/ui/SetupScreen/SetupScreen.tsx:196` |
| `Switch` | 1 file | One boolean preference (sync telemetry) | `src/features/settings/ui/SettingsScreen/SettingsPrivacyCard.tsx:31` |
| `Typography` | 1 file | Heading and paragraph inside the startup placeholder card | `src/features/startup/ui/StartupBoundary/StartupBoundaryLoading.tsx:17` |

Four `Alert` sites alias the import as `HeroAlert`; the counts above include both names.

Hooks and provider from the same package:

| Export | Files | Cited example |
| --- | --- | --- |
| `useThemeColor` | 6 | `src/features/animes/ui/AnimeEmptyState/AnimeEmptyState.tsx:10` |
| `useToast` | 3 | `src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts:64` |
| `HeroUINativeProvider` | 1 | `src/features/startup/ui/StartupBoundary/startup-boundary.helpers.ts:400` |

The provider is mounted with one app-wide config: `textProps.maxFontSizeMultiplier: 2` at
`src/features/startup/ui/StartupBoundary/startup-boundary.helpers.ts:404` and a toast content
wrapper at `:407`.

## Compound sub-components actually rendered

`Button.Label` (14 files), `Card.Body` (10), `Chip.Label` (7), `Card.Header` (4),
`Card.Title` (2), `Card.Description` (2), `Alert.Indicator` (8), `Alert.Content` (8),
`Alert.Description` (8), `Alert.Title` (5), `Dialog.Portal`/`Overlay`/`Content`/`Title`/
`Description`/`Close` (2), `BottomSheet.Portal`/`Overlay`/`Content`/`Title` (3),
`BottomSheet.Description` (1), `Label.Text` (1). Counts include both the `Alert` and
`HeroAlert` names.

Never rendered anywhere in `src/`: `Card.Footer`, `Dialog.Trigger`, `BottomSheet.Trigger`.

## Rules the repository states today

| Rule | Source | One example that follows it |
| --- | --- | --- |
| `.tsx` is dumb UI: JSX, HeroUI Native primitives and Tailwind classes via `cn()` only; no business logic | `AGENTS.md:30` | `src/components/app-text.tsx:9` |
| Use HeroUI Native, not raw React Native controls, when Tailwind/Uniwind can express the result | `AGENTS.md:32` | `src/features/startup/ui/StartupBoundary/StartupBoundaryFallback.tsx:67` |
| Complex features keep logic in `use-*.ts` and present it from a dumb `.tsx` | `AGENTS.md:36` | `src/features/startup/ui/StartupBoundary/use-startup-slow-notice.ts:22` |

`cn()` is imported in 16 files, and `StyleSheet.create` appears **0 times** in `src/` — the
Tailwind-class rule holds repo-wide.

## Where the code does not follow those rules

Measured today, not aspirational:

- **Literal colours: 18 lines in `src/`** — 12 SVG paint props in
  `src/components/cover-placeholder-scene.tsx`, 5 Ionicons `color` props, 1
  `className="text-white"`. The recount and breakdown are in
  [the README](../README.md#the-one-ui-rule).
- **React hooks inside `.tsx`: 1 of 48 files** — `useCallback` at
  `src/features/animes/ui/SeasonRatingSheet/SeasonRatingSheet.tsx:24`.
- **`useThemeColor` called straight from `.tsx`: 2 files** —
  `src/features/animes/ui/AnimeEmptyState/AnimeEmptyState.tsx:10` and
  `src/features/setup/ui/SetupQrScanner/SetupQrScanner.tsx`. Not business logic, but past the
  literal "JSX and classes only" wording.
- **Raw `View` from `react-native` for layout: 26 of 48 `.tsx` files.** Raw `Text` is imported
  in exactly one place, the wrapper itself (`src/components/app-text.tsx:2`).
- **Two text paths.** 19 files render `AppText` (65 occurrences) while the startup placeholder
  card renders `Typography` instead
  (`src/features/startup/ui/StartupBoundary/StartupBoundaryLoading.tsx:17`).

## What this page does not cover

Component sizes, spacing, radii, colours, contrast, device rendering, animation and gesture
behaviour. Those are not read from these files and are not claimed here.
