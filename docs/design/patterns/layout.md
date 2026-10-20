# Responsive layout and the two-pane shell

**Answer:** one hook resolves a layout mode from the frame the root `SafeAreaProvider` measures,
and exactly three modes exist: `phone`, `tablet-portrait`, `tablet-landscape`. Three surfaces
branch on it — the anime list, Settings, and the folder detail screen. At `tablet-landscape` the
anime list turns the filter rail into a fixed left column and the list into two columns; Settings
and the folder screen widen and split their cards. The three numbers that decide this are code
constants with no recorded design rationale, and nothing here claims how any of it looks on a
device.

> Back to the [design system README](../README.md) · [States](states.md) ·
> [HeroUI Native primitives](../components/heroui-native.md) · [Anime card](../components/anime-card.md).

## The mode contract

`LayoutMode` has exactly three members: `'phone' | 'tablet-portrait' | 'tablet-landscape'`
(`src/hooks/responsive-layout.types.ts:2`). The constants are `PHONE_BREAKPOINT = 768`
(`src/hooks/responsive-layout.constants.ts:2`), `LANDSCAPE_MIN_WIDTH = 1024`
(`src/hooks/responsive-layout.constants.ts:4`) and `LARGE_TABLET_BREAKPOINT = 1280`
(`src/hooks/responsive-layout.constants.ts:6`).

`resolveLayoutMode(width, height)` applies them in a fixed order
(`src/hooks/responsive-layout.helpers.ts:6`–`:9`), which collapses to this truth table:

| Measured width | Measured height | Mode | Line |
| --- | --- | --- | --- |
| `< 768` | any | `phone` | `src/hooks/responsive-layout.helpers.ts:6` |
| `>= 1280` | any | `tablet-landscape` | `src/hooks/responsive-layout.helpers.ts:7` |
| `1024`–`1279` | width > height | `tablet-landscape` | `src/hooks/responsive-layout.helpers.ts:8` |
| `1024`–`1279` | width <= height | `tablet-portrait` | `src/hooks/responsive-layout.helpers.ts:9` |
| `768`–`1023` | any | `tablet-portrait` | `src/hooks/responsive-layout.helpers.ts:9` |

Two consequences are easy to misread: `>= 1280` is landscape regardless of height, and a window
768–1023 wide is `tablet-portrait`, not `phone`.

`useResponsiveLayout()` reads that frame from `useSafeAreaFrame()`
(`src/hooks/use-responsive-layout.ts:18`) instead of `useWindowDimensions`, and returns
`{ layout, isCompact }` where `isCompact` is exactly `layout === 'phone'`
(`src/hooks/use-responsive-layout.ts:22`). The recorded reason for the frame source is an Android
case where window dimensions kept reporting a split-screen size after returning to full screen
(`src/hooks/use-responsive-layout.ts:11`–`:15`). `isCompact` has no consumer under `src/`: each
screen destructures `layout` only
(`src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts:67`,
`src/features/settings/ui/SettingsScreen/use-settings-screen-theme.ts:25`,
`src/features/anime-folders/ui/AnimeFoldersDetailScreen/use-anime-folders-detail-screen.ts:17`);
the unit tests are its only reader (`tests/hooks/use-responsive-layout.test.ts:35`).

## Who consumes the mode

| Surface | What the mode changes | Citation |
| --- | --- | --- |
| Anime list | body becomes `flex-row`; the filter rail moves into a fixed left column | `src/features/animes/ui/AnimeListScreen/AnimeListScreen.tsx:41`, `:46` |
| Anime list grid | `numColumns` becomes 2 with a fixed half-width cell class | `src/features/animes/ui/AnimeListScreen/AnimeListScreenContent.tsx:28`, `:32` |
| Filter rail | `orientation` flips to `vertical` inside a bordered 60-wide column | `src/features/animes/ui/AnimeListScreen/AnimeListScreenFilterSection.tsx:18`, `:20` |
| Settings | container max width plus a two-column card split | `src/features/settings/ui/SettingsScreen/SettingsScreen.tsx:61`, `:70` |
| Folder detail | container max width plus a two-column split | `src/features/anime-folders/ui/AnimeFoldersDetailScreen/AnimeFoldersDetailScreen.tsx:32` |

Settings and the folder screen never call the hook in their screen components; each receives
`layoutMode` or a derived `isWide` from its own hook
(`src/features/settings/ui/SettingsScreen/settings-screen.constants.ts:9`–`:13`,
`src/features/anime-folders/ui/AnimeFoldersDetailScreen/use-anime-folders-detail-screen.ts:34`).

## How the shell is composed today

The root layout renders `StartupBoundary` (`src/app/_layout.tsx:7`), which mounts the route tree
through a `Slot` (`src/features/startup/ui/StartupBoundary/startup-boundary.helpers.ts:325`). Inside the
tabs group, `src/app/(tabs)/_layout.tsx:5` renders `AnimeTabsLayout`, a `View className="flex-1
bg-background"` wrapping a `Stack` whose declared children are only `index` and `settings`
(`src/features/animes/ui/AnimeTabsLayout/AnimeTabsLayout.tsx:11`–`:14`). The `setup`
(`src/app/setup/index.tsx:5`) and `anime-folders` (`src/app/(tabs)/anime-folders.tsx:5`) route files
therefore get no per-route options from those layouts.

| Piece | What the code does | Citation |
| --- | --- | --- |
| Shared header | transparent header, a `ThemeToggle` built once as an element, `Inter-SemiBold` title, `Configuración` for Settings | `src/features/animes/ui/AnimeTabsLayout/use-anime-tabs-layout.ts:42`, `:57`, `:64`, `:66`, `:79` |
| Anime list header | contextual title, settings gear on the left, refresh on the right | `src/features/animes/ui/AnimeListScreen/AnimeListScreen.tsx:31`–`:37` |
| Gear | `Pressable` with an icon and `hitSlop` | `src/features/animes/ui/AnimeListScreen/AnimeListScreenHeaderLeft.tsx:11`–`:22` |
| Refresh | icon-only `Button variant="ghost"`, disabled while refreshing or when manual sync is unavailable | `src/features/animes/ui/AnimeListScreen/AnimeListScreenHeaderRight.tsx:14`–`:25` |
| Pane container | `bg-background flex-1` with `pt-16` in both branches | `src/features/animes/ui/AnimeListScreen/AnimeListScreen.tsx:30`, `:42`–`:43` |
| Left pane | rail wrapped in `bg-surface-secondary/40 border-border/40 w-60 border-r`; horizontal rail otherwise | `src/features/animes/ui/AnimeListScreen/AnimeListScreenFilterSection.tsx:18`–`:41` |
| Right pane | `flex-1` view with the status section above the content list | `src/features/animes/ui/AnimeListScreen/AnimeListScreen.tsx:55`–`:72` |
| List width | `max-w-5xl` with different horizontal padding per column count; cell `flex-[0.5] px-2` | `src/features/animes/ui/AnimeListScreen/AnimeListScreenContent.tsx:46`–`:50`, `src/features/animes/ui/AnimeListScreen/anime-list-screen.constants.ts:16` |

The rail renders itself twice: horizontally a scroll view of `Chip`s
(`src/features/animes/ui/AnimeFilterRail/AnimeFilterRail.tsx:16`–`:45`), vertically a scroll view of
rows with an `Estrenos` section label, a selection bar, a count pill and a `—` fallback
(`src/features/animes/ui/AnimeFilterRail/AnimeFilterRail.tsx:73`, `:89`, `:108`, `:125`).

Settings and the folder screen reuse the widening without a rail: a `max-w-[760px]` or
`max-w-[1120px]` container and `isWide && 'flex-row items-start'` around two `flex-1` columns
(`src/features/settings/ui/SettingsScreen/settings-screen.constants.ts:11`–`:12`,
`src/features/settings/ui/SettingsScreen/SettingsScreen.tsx:70`, `:81`).

## What this page does not assert

- **No measurements.** No unit is declared for `768`, `1024`, `1280`, `w-60`, `pt-16` or `size-10`
  in the code cited above, so this page restates numbers and claims no dp, pixel or density meaning.
- **No visual claim.** Column widths, padding, borders, tints and grid gaps are quoted as class
  strings, not evaluated. No contrast, spacing or appearance is approved here.
- **No device or rendering evidence.** No screenshot, simulator run or Native compilation backs
  anything above.
- **No design rationale for the numbers.** The only rationale on record explains the measurement
  source, not the values (`src/hooks/use-responsive-layout.ts:11`–`:15`). Nothing states why 768,
  1024 and 1280 were chosen, why `>= 1280` ignores height, or why the phone threshold compares width
  only. They are code constants, not decisions on record.
- **No two-pane claim beyond the anime list.** Settings and the folder screen widen and split
  content; neither renders a persistent left rail.
