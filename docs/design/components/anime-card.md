# Anime card (`AnimeCard`)

**Answer:** one `Card` per anime, with a fixed cover column on the left and a text column holding
the title, a toggleable progress line, an optional long-episode chip, an optional season status row,
a state badge and an actions row. The actions row is either the chapter controls or a `Reanudar`
button. This page records the card as the code writes it today, part by part, so it can be compared
against whatever replaces it. It contains no appearance claim.

> Back to the [design system README](../README.md) · [Primitives](heroui-native.md) ·
> [AppText](app-text.md) · [Layout and the two-pane shell](../patterns/layout.md).

## Files

| File | Renders |
| --- | --- |
| `AnimeCard.tsx` | `Card` → `Card.Body className="flex-row"`, cover then content; builds the meta label |
| `AnimeCardCover.tsx` | the poster column: offline image or placeholder scene |
| `AnimeCardContent.tsx` | the right column: info row, then actions row |
| `AnimeCardInfo.tsx` | title, progress toggle, long-episode chip, season status |
| `AnimeCardSeasonStatus.tsx` | season chip plus its description, one row |
| `AnimeCardStateBadge.tsx` | ellipsis for the default state, a chip otherwise |
| `AnimeCardActions.tsx` | page and folder shortcuts, season CTA, chapter controls or `Reanudar` |
| `AnimeCardChapterControls.tsx` | minus, count, plus |
| `anime-card.constants.ts` | tone map and the four state descriptors |
| `anime-card-cover.constants.ts` | `StyledImage = withUniwind(Image)` |
| `anime-card.helpers.ts` | the pure derivations the card reads |
| `anime-card.types.ts` | the props contracts |
| `use-anime-card.ts` | the card's one piece of local state and its handlers |
| `index.ts` | barrel export of `AnimeCard` and `AnimeCardProps` |

## Anatomy, in render order

| Part | What the code does | Citation |
| --- | --- | --- |
| Card shell | `Card className="mb-3 overflow-hidden p-0"` around `Card.Body className="flex-row"` | `src/features/animes/ui/AnimeCard/AnimeCard.tsx:41`–`:42` |
| Cover column | `View className="min-h-36 w-24 self-stretch"` | `src/features/animes/ui/AnimeCard/AnimeCardCover.tsx:18` |
| Cover content | `StyledImage` with `contentFit="cover"` at `absolute inset-0` when `coverUri` exists, otherwise `CoverPlaceholderScene` in the same box | `src/features/animes/ui/AnimeCard/AnimeCardCover.tsx:20`–`:24` |
| Cover source rule | never reads `anime.portada`, never falls back to a network URL | `src/features/animes/ui/AnimeCard/AnimeCardCover.tsx:8`–`:9` |
| Text column | `View className="flex-1 gap-3 p-4"` | `src/features/animes/ui/AnimeCard/AnimeCardContent.tsx:33` |
| Info row | `flex-row items-start gap-2` holding info and the state badge | `src/features/animes/ui/AnimeCard/AnimeCardContent.tsx:34` |
| Title | `AppText`, two lines maximum | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:13`–`:18` |
| Progress meta | `Pressable` labelled `Alternar episodios restantes`, `hitSlop={8}`, showing `"{n} capítulos · {state}"` or the `"{n} restantes"` form while toggled | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:19`–`:24`, `src/features/animes/ui/AnimeCard/AnimeCard.tsx:32`–`:38`, `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:56` |
| Long-episode chip | `Chip color="warning" size="sm" variant="secondary"`, only for a bridge-flagged next episode | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:29`–`:31`, `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:70`–`:74` |
| Season status | chip plus description in one `mt-2 flex-row` | `src/features/animes/ui/AnimeCard/AnimeCardSeasonStatus.tsx:9`–`:13` |
| State badge, default | ellipsis `Pressable` `h-7 w-7 rounded-full`, label `Cambiar estado del anime` | `src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx:14`–`:22` |
| State badge, other | `Chip size="sm" variant="secondary"`, label `Cambiar estado: {label}` | `src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx:26`–`:36` |
| Actions row | `flex-row items-center gap-2`, with a `flex-1` spacer before the CTA | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:29`, `:52` |
| Shortcuts | icon-only `Button size="sm" variant="tertiary"`, labels `Abrir página del anime` / `Abrir carpeta del anime` | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:31`–`:50` |
| Season CTA | labelled `Button` (`Temporada`), `size="sm" variant="secondary"`, label `Abrir calificación de temporada` | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:55`–`:62` |
| Locked state | labelled `Reanudar` button with a play icon, shown instead of the chapter controls | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:65`–`:73` |
| Chapter controls | two `isIconOnly size-10` buttons, `variant="danger"` and `"primary"`, with a count `AppText` between them | `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:20`–`:44` |

Icon-only today: the page shortcut, the folder shortcut, the chapter minus and plus, and the list
header refresh. Carrying a visible label: `Temporada` and `Reanudar`. The chapter buttons are the only
parts whose accessibility labels are English while the rest of the card is Spanish
(`src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:21`, `:35`).

Both chapter buttons also react to a long press, which halves the step instead of applying one
(`src/features/animes/ui/AnimeCard/use-anime-card.ts:61`–`:67`). Each is disabled when the card is
mutating, when the anime is mutation-locked (`estado !== 0`), or when the move is impossible:
decrement needs `nrocapvisto > 0`, increment is blocked once a known total is reached
(`src/features/animes/ui/AnimeCard/use-anime-card.ts:28`–`:34`,
`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:10`, `:18`, `:26`).

## Primitives and roles

| Part | Primitive | Citation |
| --- | --- | --- |
| Shell | `Card`, `Card.Body` | `src/features/animes/ui/AnimeCard/AnimeCard.tsx:1`, `:41`–`:42` |
| Chips | `Chip`, `Chip.Label` | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:29`–`:31`, `src/features/animes/ui/AnimeCard/AnimeCardSeasonStatus.tsx:10`–`:11` |
| Buttons | `Button`, `Button.Label` | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:55`–`:61`, `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:20`–`:29` |
| Icons | `StyledIonicons` (`withUniwind(Ionicons)`) takes classes; plain `Ionicons` takes `color="#ffffff"` | `src/components/theme-toggle.constants.ts:6`, `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:38`, `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:29` |
| Text | `AppText`, which prepends `font-normal` | `src/components/app-text.tsx:9` |
| Placeholder | `CoverPlaceholderScene` | `src/components/cover-placeholder-scene.tsx:86` |
| Touches | React Native `View` and `Pressable` only | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:19`, `src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx:14` |

Semantic roles on the card: `text-foreground` for the title and the count, `text-muted` for the meta
line, the season description and the ellipsis icon, and the chip tones `accent`, `success`, `warning`
and `danger` through `CHIP_TONE_COLOR_MAP`
(`src/features/animes/ui/AnimeCard/anime-card.constants.ts:4`–`:9`). The two `#ffffff` icon colours
above are the card's only colour literals (`src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:29`).

## Type scale as written on the card

| Element | Classes / props in code | Citation |
| --- | --- | --- |
| Title | `text-sm font-semibold leading-tight` | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:14` |
| Progress meta | `text-xs` | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:26` |
| Season description | `text-xs` | `src/features/animes/ui/AnimeCard/AnimeCardSeasonStatus.tsx:13` |
| Chapter count | `text-base font-semibold tabular-nums` | `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:31` |
| Every chip | `size="sm" variant="secondary"` | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:29`, `src/features/animes/ui/AnimeCard/AnimeCardSeasonStatus.tsx:10`, `src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx:33` |
| Icon-only chrome | `size-10` for chapters, `size="sm"` for shortcuts and CTAs | `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:27`, `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:34` |

## Season mode and the rating interaction

The card has **no season-mode branch**. Season mode is read from the pairing row
(`src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts:89`) and changes the default filter
to `Ver hoy` (`src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts:321`,
`src/features/animes/anime.helpers.ts:90`–`:91`) plus a `Modo temporada` chip in the list's status
section (`src/features/animes/ui/AnimeListScreen/AnimeListScreenStatusSection.tsx:20`–`:24`). What
appears on the card is projection-driven: `buildAnimeSeasonProjection` returns `null` unless the anime
is a candidate of the open season (`src/features/animes/anime-season.helpers.ts:55`–`:57`), and
`getAnimeSeasonStatus` returns `null` without a projection
(`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:84`–`:86`). Its four outcomes are a failed
local intent (`:88`), a pending local intent (`:97`), a confirmed bridge rating (`:106`) and no rating
yet (`:115`); `showRatingCta` is `true` in all four.

Rating today: the `Temporada` button calls `onOpenSeasonRatingSheet` with the anime id
(`src/features/animes/ui/AnimeCard/use-anime-card.ts:69`–`:71`), the list handler builds the request
from that anime's projection (`src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts:248`),
and the request opens a HeroUI Native `BottomSheet`
(`src/features/animes/ui/AnimeListScreen/AnimeListScreenSheets.tsx:27`,
`src/features/animes/ui/SeasonRatingSheet/SeasonRatingSheet.tsx:184`). The sheet offers 1 to 6 as
buttons labelled `Calificar {n} de 6`
(`src/features/animes/ui/SeasonRatingSheet/season-rating-sheet.constants.ts:2`,
`src/features/animes/ui/SeasonRatingSheet/SeasonRatingSheet.tsx:28`). The state badge opens the same
kind of sheet (`src/features/animes/ui/AnimeStateSheet/AnimeStateSheet.tsx:19`).

## What this page does not claim

- **No appearance, no rendering.** Nothing here approves spacing, contrast, hierarchy or polish, and
  no screenshot, simulator, device or Native-compilation observation backs any statement; class
  strings are quoted, not evaluated.
- **No responsive claim for the card.** `AnimeCardProps` carries no layout mode
  (`src/features/animes/ui/AnimeCard/anime-card.types.ts:5`–`:24`), so the card does not change its own
  composition per mode; only the cell around it does
  (`src/features/animes/ui/AnimeListScreen/AnimeListScreenContent.tsx:32`).
- **No consistency claim.** The English chapter labels and the two `#ffffff` icon colours are recorded
  as they are, not as a rule for new work.
