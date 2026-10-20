# Anime card (`AnimeCard`)

**Answer:** one `Card` per anime, with a fixed cover column on the left and a text column holding
the title, one meta line under it, an optional long-episode chip and a state ellipsis beside the
title. The meta line carries the watched count, the state and the note in that order, separated by a
conditional dot, so no separator is ever left on its own, and it is the **only** place the note
appears. The actions row is either the chapter controls or a `Reanudar` button. Every pressable on
the card reaches at least 44 pt as a touch target — as a hit area, so nothing that is drawn changes.
This page records the card as the code writes it today, part by part, so it can be compared against
whatever replaces it. It contains no appearance claim: class strings are quoted, never evaluated.

> Back to the [design system README](../README.md) · [Primitives](heroui-native.md) ·
> [AppText](app-text.md) · [Layout and the two-pane shell](../patterns/layout.md).

## Files

| File | Renders |
| --- | --- |
| `AnimeCard.tsx` | `Card` → `Card.Body className="flex-row"`, cover then content; asks the helpers for the meta line |
| `AnimeCardCover.tsx` | the poster column: offline image or placeholder scene |
| `AnimeCardContent.tsx` | the right column: info row, then actions row |
| `AnimeCardInfo.tsx` | title, the single meta line and its toggle, long-episode chip |
| (removed) `AnimeCardSeasonStatus.tsx` | season chip plus its description in one row — **deleted with this change** |
| `AnimeCardStateBadge.tsx` | the state ellipsis: one control for every state, no chip |
| `AnimeCardActions.tsx` | page and folder shortcuts, season CTA, chapter controls or `Reanudar` |
| `AnimeCardChapterControls.tsx` | minus, count, plus |
| `anime-card.constants.ts` | the meta separator and the four state labels |
| `anime-card-cover.constants.ts` | `StyledImage = withUniwind(Image)` |
| `anime-card.helpers.ts` | the pure derivations the card reads, including the meta-line composition |
| `anime-card.types.ts` | the props contracts |
| `use-anime-card.ts` | the card's one piece of local state and its handlers |
| `index.ts` | barrel export of `AnimeCard` and `AnimeCardProps` |

## Anatomy, in render order

| Part | What the code does | Citation |
| --- | --- | --- |
| Card shell | `Card className="mb-3 overflow-hidden p-0"` around `Card.Body className="flex-row"` | `src/features/animes/ui/AnimeCard/AnimeCard.tsx:42`–`:43` |
| Cover column | `View className="min-h-36 w-24 self-stretch"` | `src/features/animes/ui/AnimeCard/AnimeCardCover.tsx:18` |
| Cover content | `StyledImage` with `contentFit="cover"` at `absolute inset-0` when `coverUri` exists, otherwise `CoverPlaceholderScene` in the same box | `src/features/animes/ui/AnimeCard/AnimeCardCover.tsx:20`–`:24` |
| Cover source rule | never reads `anime.portada`, never falls back to a network URL | `src/features/animes/ui/AnimeCard/AnimeCardCover.tsx:8`–`:9` |
| Text column | `View className="flex-1 gap-3 p-4"` | `src/features/animes/ui/AnimeCard/AnimeCardContent.tsx:33` |
| Info row | `flex-row items-start gap-2` holding info and the state ellipsis | `src/features/animes/ui/AnimeCard/AnimeCardContent.tsx:34` |
| Title | `AppText`, `text-sm font-semibold leading-tight`, two lines maximum | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:19`–`:24` |
| Meta line | `Pressable` labelled `Alternar episodios restantes` with `mt-1 min-h-11 min-w-11`, wrapping the line in one `AppText className="text-muted text-xs"` that sets no `numberOfLines` | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:29`–`:36` |
| Meta line composition | `getAnimeCardMetaLabel({ nrocapvisto, stateLabel, noteLabel, restantesLabel, restantesShown })` | `src/features/animes/ui/AnimeCard/AnimeCard.tsx:33`–`:39`, `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:80`–`:86` |
| Meta line, count segment | `1 capítulo visto` / `{n} capítulos vistos`, fractional counts kept | `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:48`–`:50` |
| Meta line, state segment | the `label` of the persisted state, always present | `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:40`–`:42`, `src/features/animes/ui/AnimeCard/anime-card.constants.ts:7`–`:12` |
| Meta line, note segment | the season status label, `null` when the anime has no season candidacy | `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:58`–`:62`, `:155`–`:169` |
| Meta separator rule | absent and blank segments are dropped **before** joining, so no separator leads, trails or doubles | `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:68`–`:73`, `src/features/animes/ui/AnimeCard/anime-card.constants.ts:3`–`:4` |
| Remaining form | `{n} restantes`, which replaces only the count segment while the toggle is on | `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:92`–`:106` |
| Long-episode chip | `Chip color="warning" size="sm" variant="secondary"`, only for a bridge-flagged next episode | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:38`–`:40`, `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:113`–`:124` |
| State control | one muted ellipsis `Pressable`, `h-7 w-7 rounded-full`, `hitSlop={8}`, label `Cambiar estado: {label}`, for every state | `src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx:13`–`:21` |
| Actions row | `flex-row items-center gap-2`, with a `flex-1` spacer before the CTA | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:33`, `:58` |
| Shortcuts | icon-only `Button size="sm" variant="tertiary"` with `hitSlop={4}`, labels `Abrir página del anime` / `Abrir carpeta del anime` | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:34`–`:57` |
| Season CTA | labelled `Button` (`Temporada`), `size="sm" variant="secondary"` with `hitSlop={4}`, label `Abrir calificación de temporada`, drawn only when `seasonStatus.showRatingCta` | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:59`–`:70` |
| Locked state | labelled `Reanudar` button with a play icon and `hitSlop={4}`, shown instead of the chapter controls | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:71`–`:81` |
| Chapter controls | two `isIconOnly size-10` buttons with `hitSlop={4}`, `variant="danger"` and `"primary"`, labels `Restar un capítulo visto` / `Sumar un capítulo visto`, with a count `AppText` between them | `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:24`–`:50` |

## The meta line

One line, three segments, in this order: count, state, note. The state comes from
`STATE_CHIP_BY_ESTADO` (`Viendo`, `Finalizado`, `No me gustó`, `En pausa`) and the note is the
season status label, where a confirmed bridge rating reads `Nota {n}/6` and an ungraded candidate
reads `Sin nota` (`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:155`–`:169`). The lines the
composition produces, as strings rather than as renders:

| Case | Line |
| --- | --- |
| one chapter, viewing, rated 3 | `1 capítulo visto · Viendo · Nota 3/6` |
| six chapters, paused, rated 4 | `6 capítulos vistos · En pausa · Nota 4/6` |
| no season candidacy, so no note segment | `3 capítulos vistos · Viendo` |
| candidate without a rating | `1 capítulo visto · Viendo · Sin nota` |
| toggle on, remaining form | `6 restantes · Viendo · Nota 4/6` |

Three consequences worth stating plainly:

- **A separator is never alone.** `composeMetaLine` filters the empty segments before it joins, so an
  absent note cannot leave a trailing `·`
  (`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:68`–`:73`).
- **The state can no longer fall out of the line.** It is a segment for every `estado`, `En pausa`
  included; the same label also survives in the ellipsis accessibility label
  (`src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx:15`).
- **The toggle swaps one segment, not the line.** While it is on, only the count becomes
  `{n} restantes`, so the state and the note stay visible
  (`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:81`–`:83`).

The state is no longer a coloured chip anywhere on the card. `CHIP_TONE_COLOR_MAP` and the
`Cambiar estado: {label}` chip branch are gone from
`src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx`; the season descriptor no longer carries a `tone`,
and nothing on the card reads it. The ellipsis still opens the existing `AnimeStateSheet` through the
`onOpenStateSheet` callback the card receives (`src/features/animes/ui/AnimeCard/use-anime-card.ts:57`–`:59`).

## Touch targets and narrow widths

Every pressable this surface owns reaches at least 44 pt as a **hit area**, and none of them grew a
size class to get there: the drawn sizes, the `gap-2` row rhythm and the `p-4 gap-3` column are the
same as before the change.

| Control | Drawn size | Hit area | Citation |
| --- | --- | --- | --- |
| State ellipsis | 28 pt (`h-7 w-7`), icon `size={18}` | `hitSlop={8}` on every side = 44 pt | `src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx:17`–`:18` |
| Meta toggle | the `text-xs` line itself | `min-h-11 min-w-11` on the `Pressable` = 44 pt | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:29`–`:34` |
| Page shortcut | 40 pt (`size="sm"`, `isIconOnly`) | `hitSlop={4}` on every side = 48 pt | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:35`–`:42` |
| Folder shortcut | 40 pt (`size="sm"`, `isIconOnly`) | `hitSlop={4}` on every side = 48 pt | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:47`–`:54` |
| `Temporada` CTA | 40 pt tall (`size="sm"`) | `hitSlop={4}` on every side = 48 pt | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:60`–`:67` |
| `Reanudar` | 40 pt tall (`size="sm"`) | `hitSlop={4}` on every side = 48 pt | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:72`–`:78` |
| Chapter minus | 40 pt (`size-10`) | `hitSlop={4}` on every side = 48 pt | `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:24`–`:33` |
| Chapter plus | 40 pt (`size-10`) | `hitSlop={4}` on every side = 48 pt | `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:39`–`:48` |

`hitSlop` on a `Button` reaches the root `Pressable` because the component spreads its remaining
props onto it (`node_modules/heroui-native/lib/module/components/button/button.js`), which is why the
value is set per button rather than through a wrapper. The arithmetic is read from props, not
measured: `size="sm"` is `h-10` in the library's own size table and `size-10` is 40 pt.

Narrow widths: the meta line is one `AppText` with no `numberOfLines` and no nowrap, inside a
`flex-1` column, so a long count or note wraps instead of a segment being clipped. Only the title is
capped, at two lines (`src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:21`). This is a statement
about props, not about measured layout.

Icon-only today: the page shortcut, the folder shortcut, the state ellipsis, the chapter minus and
plus, and the list header refresh. Carrying a visible label: `Temporada` and `Reanudar`. Every
accessibility label on the card is Spanish: `Alternar episodios restantes`, `Cambiar estado: {label}`,
`Abrir página del anime`, `Abrir carpeta del anime`, `Abrir calificación de temporada`,
`Reanudar anime`, `Restar un capítulo visto` and `Sumar un capítulo visto`
(`src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:25`, `:40`).

Both chapter buttons also react to a long press, which halves the step instead of applying one
(`src/features/animes/ui/AnimeCard/use-anime-card.ts:61`–`:67`). Each is disabled when the card is
mutating, when the anime is mutation-locked (`estado !== 0`), or when the move is impossible:
decrement needs `nrocapvisto > 0`, increment is blocked once a known total is reached
(`src/features/animes/ui/AnimeCard/use-anime-card.ts:28`–`:34`,
`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:10`, `:18`, `:26`).

## Primitives and roles

| Part | Primitive | Citation |
| --- | --- | --- |
| Shell | `Card`, `Card.Body` | `src/features/animes/ui/AnimeCard/AnimeCard.tsx:1`, `:42`–`:43` |
| Chips | `Chip`, `Chip.Label`, only for the long-episode mark | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:38`–`:40` |
| Buttons | `Button`, `Button.Label` | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:60`–`:69`, `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:24`–`:35` |
| Icons | `StyledIonicons` (`withUniwind(Ionicons)`) takes classes; plain `Ionicons` takes `color="#ffffff"` | `src/components/theme-toggle.constants.ts:6`, `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:43`, `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:34` |
| Text | `AppText`, which prepends `font-normal` | `src/components/app-text.tsx:9` |
| Placeholder | `CoverPlaceholderScene` | `src/components/cover-placeholder-scene.tsx:86` |
| Touches | React Native `View` and `Pressable` only | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:29`, `src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx:13` |

Semantic roles on the card: `text-foreground` for the title and the chapter count, and `text-muted`
for the whole meta line and the ellipsis icon. The card draws one chip: the long-episode mark, on
`warning` (`src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:38`). The season chip and its
`warning`/`accent` tone lived in the deleted `AnimeCardSeasonStatus.tsx` and no longer exist anywhere,
but nothing on the card mounts that row any more. The two `#ffffff` icon colours of the chapter
buttons are the card's only colour literals
(`src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:34`, `:49`).

## Type scale as written on the card

| Element | Classes / props in code | Citation |
| --- | --- | --- |
| Title | `text-sm font-semibold leading-tight` | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:20` |
| Meta line | `text-xs`, count, state and note at that one size | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:35` |
| Chapter count | `text-base font-semibold tabular-nums` | `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:36` |
| Every chip | `size="sm" variant="secondary"`; only the long-episode mark is drawn | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:38` |
| Icon-only chrome | `size-10` plus `hitSlop={4}` for chapters, `size="sm"` plus `hitSlop={4}` for shortcuts and CTAs | `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:32`, `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:38` |

The proposals page describes a 16/13/11 scale for a redesigned card
([proposals](../proposals/anime-cards-and-season-rating.md)). The card does **not** use it: it renders
two sizes today, `text-sm` for the title and `text-xs` for the meta line.

## Season mode and the rating interaction

The card has **no season-mode branch**. Season mode is read from the pairing row
(`src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts:89`) and changes the default filter
to `Ver hoy` (`src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts:321`,
`src/features/animes/anime.helpers.ts:90`–`:91`) plus a `Modo temporada` chip in the list's status
section (`src/features/animes/ui/AnimeListScreen/AnimeListScreenStatusSection.tsx:20`–`:24`). What
appears on the card is projection-driven: `buildAnimeSeasonProjection` returns `null` unless the anime
is a candidate of the open season (`src/features/animes/anime-season.helpers.ts:55`–`:57`), and
`getAnimeSeasonStatus` returns `null` without a projection
(`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:133`–`:135`). Its four outcomes are a failed
local intent (`:137`), a pending local intent (`:146`), a confirmed bridge rating (`:155`) and no
rating yet (`:164`); `showRatingCta` is `true` in all four.

Because the note segment reads that same descriptor, the card used to show a season candidate's note
twice: on the meta line and again in a season status row with a description. **That row is gone.**
`AnimeCardInfo` no longer mounts `AnimeCardSeasonStatus`, so the note is drawn exactly once, on the
meta line, and no bridge wording reaches the card. Two things still read `seasonStatus`:

- `getNoteSegmentLabel(seasonStatus)` takes `label` for the note segment
  (`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:59`–`:62`,
  `src/features/animes/ui/AnimeCard/AnimeCard.tsx:36`).
- `AnimeCardActions` reads `showRatingCta`, which is `true` in all four outcomes, to decide whether
the `Temporada` CTA is drawn (`src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:59`).

`description` and `tone` were removed from `getAnimeSeasonStatus` and from
`AnimeSeasonStatusDescriptor`. The component that drew them, `AnimeCardSeasonStatus.tsx`, was deleted
in the same change, so no dead component and no unrendered field remain
(`src/features/animes/ui/AnimeCard/anime-card.types.ts:48`–`:56`).

Rating today: the `Temporada` button calls `onOpenSeasonRatingSheet` with the anime id
(`src/features/animes/ui/AnimeCard/use-anime-card.ts:69`–`:71`), the list handler builds the request
from that anime's projection (`src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts:248`),
and the request opens a HeroUI Native `BottomSheet`
(`src/features/animes/ui/AnimeListScreen/AnimeListScreenSheets.tsx:27`,
`src/features/animes/ui/SeasonRatingSheet/SeasonRatingSheet.tsx:184`). The sheet offers 1 to 6 as
buttons labelled `Calificar {n} de 6`
(`src/features/animes/ui/SeasonRatingSheet/season-rating-sheet.constants.ts:2`,
`src/features/animes/ui/SeasonRatingSheet/SeasonRatingSheet.tsx:28`). The state ellipsis opens the same
kind of sheet (`src/features/animes/ui/AnimeStateSheet/AnimeStateSheet.tsx:19`).

## What this page does not claim

- **No appearance, no rendering.** Nothing here approves spacing, contrast, hierarchy or polish, and
  no screenshot, simulator, device or Native-compilation observation backs any statement.
- **No measured touch target and no measured wrap.** The 44 pt and 48 pt areas and the wrapping meta
  line are read from props and class names (`min-h-11`, `hitSlop={8}`, `hitSlop={4}`, no
  `numberOfLines`); nothing here measured a device.
- **No responsive claim for the card.** `AnimeCardProps` carries no layout mode
  (`src/features/animes/ui/AnimeCard/anime-card.types.ts:5`–`:24`), so the card does not change its own
  composition per mode; only the cell around it does
  (`src/features/animes/ui/AnimeListScreen/AnimeListScreenContent.tsx:32`).
- **No claim about native appearance.** The season row was removed, so the note is drawn once; that
  is a code fact. Nothing here proves how the resulting card looks on a device.
- **No claim that the proposals page is implemented.** The approved redesign also asks for the
  16/13/11 scale, the neutral decrease control, the star affordance and no `Temporada` button; none of
  that is on the card yet.
