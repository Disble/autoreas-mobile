# Anime card (`AnimeCard`)

**Answer:** one `Card` per anime, with a fixed cover column on the left and a text column holding
the title, one meta line under it, an optional long-episode chip and a state ellipsis beside the
title. The meta line carries the watched count, the state and the note in that order, separated by a
conditional dot, so no separator is ever left on its own, and it is the **only** place the note
appears. The title is 16 pt at weight 400 in `foreground`; on the meta line the count is 13 pt and the
state and the note are 11 pt, all in `muted`, and each part is drawn as its own span so it carries its
own size. The actions row is either the chapter controls or a `Reanudar` button. Every pressable on
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
| `AnimeCardContent.tsx` | the right column: info row (forwarding the meta segments and their composed label), then actions row |
| `AnimeCardInfo.tsx` | title at 16 pt/400, the meta line drawn as one span per segment plus its toggle, long-episode chip |
| (removed) `AnimeCardSeasonStatus.tsx` | season chip plus its description in one row — **deleted with this change** |
| `AnimeCardStateBadge.tsx` | the state ellipsis: one control for every state, no chip |
| `AnimeCardActions.tsx` | the `AnimeCardShortcuts` group on the left; chapter controls or `Reanudar` on the right |
| `AnimeCardShortcuts.tsx` | page, folder and note star |
| `AnimeCardChapterControls.tsx` | minus and plus, no count between them |
| `anime-card.constants.ts` | the meta separator and the four state labels |
| `anime-card-cover.constants.ts` | `StyledImage = withUniwind(Image)` |
| `anime-card.helpers.ts` | the pure derivations the card reads, including the meta-line segments and their composed label |
| `anime-card.types.ts` | the props contracts |
| `use-anime-card.ts` | the card's one piece of local state and its handlers |
| `index.ts` | barrel export of `AnimeCard` and `AnimeCardProps` |

## Anatomy, in render order

| Part | What the code does | Citation |
| --- | --- | --- |
| Card shell | `Card className="mb-3 overflow-hidden p-0"` around `Card.Body className="flex-row"` | `src/features/animes/ui/AnimeCard/AnimeCard.tsx:42`–`:43` |
| Cover column | `View className="w-24 self-stretch"`: 96 pt wide, no minimum height, so the text column sets the card height and a one-line card keeps its 16 pt bottom edge | `src/features/animes/ui/AnimeCard/AnimeCardCover.tsx:18` |
| Cover content | `StyledImage` with `contentFit="cover"` at `absolute inset-0` when `coverUri` exists, otherwise `CoverPlaceholderScene` in the same box | `src/features/animes/ui/AnimeCard/AnimeCardCover.tsx:20`–`:24` |
| Cover source rule | never reads `anime.portada`, never falls back to a network URL | `src/features/animes/ui/AnimeCard/AnimeCardCover.tsx:8`–`:9` |
| Text column | `View className="flex-1 gap-3 p-4"`: 16 pt container edge, 12 pt between the text group and the actions row ([spacing tiers](../foundations/spacing.md)) | `src/features/animes/ui/AnimeCard/AnimeCardContent.tsx:34` |
| Info row | `flex-row items-start gap-2` holding info and the state ellipsis | `src/features/animes/ui/AnimeCard/AnimeCardContent.tsx:35` |
| Title | `AppText`, `text-foreground text-base leading-tight`, two lines maximum; weight 400 is the `font-normal` AppText prepends | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:56` |
| Meta line | `Pressable` whose accessible label is the whole composed line, with `mt-1` (4 pt under the title, inside the title group) and `hitSlop={META_TOGGLE_HIT_SLOP}`, wrapping one `AppText className="text-muted leading-[18px]"` that holds one span per segment | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:22`–`:41` |
| Meta line, drawn spans | one `AppText` per segment: `text-reading text-[13px]` for the count, `text-muted text-[11px]` for the state and the note, each later segment prefixed with the round dot ` • ` (`META_DOT_SEPARATOR`) while the spoken label keeps ` · `; no span sets `numberOfLines` or nowrap | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:29`–`:40` |
| Meta line composition | `getAnimeCardMetaSegments({ nrocapvisto, stateLabel, noteLabel, restantesLabel, restantesShown })` for the drawn segments, and `getAnimeCardMetaLabel` for the composed accessible label | `src/features/animes/ui/AnimeCard/AnimeCard.tsx:33`–`:41`, `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:88`–`:102`, `:109`–`:111` |
| Meta line, count segment | `{ kind: 'count', text }`: `1 capítulo visto` / `{n} capítulos vistos`, fractional counts kept | `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:49`–`:51`, `:96` |
| Meta line, state segment | `{ kind: 'state', text: label }`, the label of the persisted state, always present | `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:41`–`:43`, `:97`, `src/features/animes/ui/AnimeCard/anime-card.constants.ts:7`–`:12` |
| Meta line, note segment | `{ kind: 'note', text }`, the season status label, dropped when the anime has no season candidacy | `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:59`–`:63`, `:98`, `:155`–`:170` |
| Meta separator rule | absent and blank segments are dropped before the view sees them, and the dot is prepended only to a segment that is not first, so it never leads, trails or doubles | `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:69`–`:79`, `:101`, `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:37`, `src/features/animes/ui/AnimeCard/anime-card.constants.ts:3`–`:4` |
| Remaining form | `{n} restantes`, which replaces only the count segment's text while the toggle is on | `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:117`–`:131` |
| Long-episode chip | `Chip color="warning" size="sm" variant="secondary"`, only for a bridge-flagged next episode | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:64`–`:68`, `src/features/animes/ui/AnimeCard/anime-card.helpers.ts:138`–`:149` |
| State control | one muted ellipsis `Pressable`, `h-7 w-7 rounded-full`, `hitSlop={8}`, label `Cambiar estado: {label}`, for every state | `src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx:13`–`:21` |
| Actions row | `flex-row items-center gap-2`: the `AnimeCardShortcuts` group, a `flex-1` spacer, then the stepper or `Reanudar` | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:34`–`:43` |
| Shortcuts | icon-only `Button size="sm" variant="tertiary"` with `hitSlop={4}`, icons `link-outline` / `folder-outline` at 20 pt, labels `Abrir página del anime` / `Abrir carpeta del anime`, first in the left group | `src/features/animes/ui/AnimeCard/AnimeCardShortcuts.tsx:19`–`:42` |
| Note star | icon-only `Button` (`star-outline` at 20 pt, `text-accent-soft-foreground`), `size="sm" variant="tertiary"` with `hitSlop={4}`, label `Abrir la calificación de la nota`, last in the left group and drawn only when `seasonStatus.showRatingCta` | `src/features/animes/ui/AnimeCard/AnimeCardShortcuts.tsx:43`–`:54` |
| Locked state | labelled `Reanudar` button with a `play-outline` icon and `hitSlop={4}`, shown instead of the chapter controls | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:44`–`:54` |
| Chapter controls | two `isIconOnly size-10` buttons with `hitSlop={4}`, `variant="tertiary"` and `"primary"`, `remove-outline` / `add-outline` at 20 pt, labels `Restar un capítulo visto` / `Sumar un capítulo visto`, 12 pt apart (`gap-3`) with no count between them; the count lives on the meta line | `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:24`–`:49` |

## The meta line

One line, three segments, in this order: count, state, note. The state comes from
`STATE_CHIP_BY_ESTADO` (`Viendo`, `Finalizado`, `No me gustó`, `En pausa`) and the note is the
season status label, where a confirmed bridge rating reads `Nota {n}/6` and an ungraded candidate
reads `Sin nota` (`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:155`–`:170`).
`getAnimeCardMetaSegments` returns them as ordered segments, each carrying its text and its kind
(`count`, `state`, `note`), and the view draws one `AppText` span per segment
(`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:88`–`:102`,
`src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:29`–`:40`). The lines the composition produces,
as strings rather than as renders:

| Case | Line |
| --- | --- |
| one chapter, viewing, rated 3 | `1 capítulo visto · Viendo · Nota 3/6` |
| six chapters, paused, rated 4 | `6 capítulos vistos · En pausa · Nota 4/6` |
| no season candidacy, so no note segment | `3 capítulos vistos · Viendo` |
| candidate without a rating | `1 capítulo visto · Viendo · Sin nota` |
| toggle on, remaining form | `6 restantes · Viendo · Nota 4/6` |

Three consequences worth stating plainly:

- **A separator is never alone.** `getAnimeCardMetaSegments` drops the absent and blank segments
  before the view sees them, and `composeMetaLine` filters them again before it joins, so an absent
  note can leave neither a trailing `·` nor a separator with no text beside it
  (`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:101`, `:69`–`:79`). The view prepends the
  dot only to a segment that is not first (`src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:37`).
- **The state can no longer fall out of the line.** It is a segment for every `estado`, `En pausa`
  included; the same label also survives in the ellipsis accessibility label
  (`src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx:15`).
- **The toggle swaps one segment, not the line.** While it is on, only the count becomes
  `{n} restantes`, so the state and the note stay visible
  (`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:91`–`:93`).

The sizes are per segment, because the line is drawn as several spans rather than one string: the
count is `text-[13px]`, and the state and the note are `text-[11px]`. The count carries the app's
`reading` role, one step brighter than `muted`, and the state and the note carry `text-muted`, as the
approved card asks (`docs/design/foundations/color-tokens.md`). Weight is 400 for all three, from the `font-normal`
`AppText` prepends (`src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:33`–`:35`,
`src/components/app-text.tsx:9`).

The line is also **one accessible string**. The `Pressable` carries the composed line as its
`accessibilityLabel` and the toggle action as its `accessibilityHint`, so a screen reader hears
`6 capítulos vistos · En pausa · Nota 4/6` followed by the hint instead of three unrelated spans
(`src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:24`–`:25`). The label and the spans come from the
same segments, so they cannot disagree (`src/features/animes/ui/AnimeCard/AnimeCard.tsx:40`–`:41`).

The state is no longer a coloured chip anywhere on the card. `CHIP_TONE_COLOR_MAP` and the
`Cambiar estado: {label}` chip branch are gone from
`src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx`; the season descriptor no longer carries a `tone`,
and nothing on the card reads it. The ellipsis still opens the existing `AnimeStateSheet` through the
`onOpenStateSheet` callback the card receives (`src/features/animes/ui/AnimeCard/use-anime-card.ts:57`–`:59`).

## Touch targets and narrow widths

Every pressable this surface owns reaches at least 44 pt as a **hit area**, and none of them grows a
size class to get there: the drawn sizes, the `gap-2` row rhythm and the `p-4 gap-3` column follow the
[spacing tiers](../foundations/spacing.md). The meta line used to reach 44 pt through `min-h-11`,
which drew 26 pt of invisible box around the text and left it as far from the title as from the
actions; it now uses slop.

| Control | Drawn size | Hit area | Citation |
| --- | --- | --- | --- |
| State ellipsis | 28 pt (`h-7 w-7`), icon `size={18}` | `hitSlop={8}` on every side = 44 pt | `src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx:17`–`:18` |
| Meta toggle | the 13/11 pt line, 18 pt tall (`leading-[18px]`) | `META_TOGGLE_HIT_SLOP` = 14 pt above + 12 pt below = 44 pt | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:22`–`:28` |
| Page shortcut | 40 pt (`size="sm"`, `isIconOnly`) | `hitSlop={4}` on every side = 48 pt | `src/features/animes/ui/AnimeCard/AnimeCardShortcuts.tsx:20`–`:29` |
| Folder shortcut | 40 pt (`size="sm"`, `isIconOnly`) | `hitSlop={4}` on every side = 48 pt | `src/features/animes/ui/AnimeCard/AnimeCardShortcuts.tsx:32`–`:41` |
| Note star | 40 pt (`size="sm"`, icon only) | `hitSlop={4}` on every side = 48 pt | `src/features/animes/ui/AnimeCard/AnimeCardShortcuts.tsx:44`–`:53` |
| `Reanudar` | 40 pt tall (`size="sm"`) | `hitSlop={4}` on every side = 48 pt | `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:45`–`:54` |
| Chapter minus | 40 pt (`size-10`) | `hitSlop={4}` on every side = 48 pt | `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:24`–`:33` |
| Chapter plus | 40 pt (`size-10`) | `hitSlop={4}` on every side = 48 pt | `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:39`–`:48` |

`hitSlop` on a `Button` reaches the root `Pressable` because the component spreads its remaining
props onto it (`node_modules/heroui-native/lib/module/components/button/button.js`), which is why the
value is set per button rather than through a wrapper. The arithmetic is read from props, not
measured: `size="sm"` is `h-10` in the library's own size table and `size-10` is 40 pt.

Narrow widths: the meta line is one `AppText` holding one span per segment, and neither the wrapper
nor any span sets `numberOfLines` or nowrap, inside a `flex-1` column, so a long count or note wraps
instead of a segment being clipped. Only the title is capped, at two lines
(`src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:56`). This is a statement about props, not about
measured layout.

Icon-only today: the page shortcut, the folder shortcut, the state ellipsis, the chapter minus and
plus, and the list header refresh. Carrying a visible label: `Reanudar`. Every other control there is
accessibility label on the card is Spanish: the composed meta line
(`6 capítulos vistos · En pausa · Nota 4/6`) with `Alternar episodios restantes` as its hint,
`Cambiar estado: {label}`, `Abrir página del anime`, `Abrir carpeta del anime`,
`Abrir calificación de temporada`, `Reanudar anime`, `Restar un capítulo visto` and
`Sumar un capítulo visto` (`src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:25`, `:40`).

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
| Buttons | `Button`, `Button.Label` | `src/features/animes/ui/AnimeCard/AnimeCardShortcuts.tsx:20`–`:53`, `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:45`–`:54`, `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:25`–`:48` |
| Icons | Every card icon is the Ionicons `-outline` variant, at 20 pt in the actions row; `StyledIonicons` (`withUniwind(Ionicons)`) takes classes, and the plain `Ionicons` play glyph inherits the `Reanudar` button colour | `src/components/theme-toggle.constants.ts:6`, `src/features/animes/ui/AnimeCard/AnimeCardShortcuts.tsx:28`, `src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:52`, `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:35` |
| Text | `AppText`, which prepends `font-normal` | `src/components/app-text.tsx:9` |
| Placeholder | `CoverPlaceholderScene` | `src/components/cover-placeholder-scene.tsx:86` |
| Touches | React Native `View` and `Pressable` only | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:22`, `src/features/animes/ui/AnimeCard/AnimeCardStateBadge.tsx:13` |

Semantic roles on the card: `text-foreground` for the title, `text-reading` for the watched count,
and `text-muted` for the state, the note and the ellipsis icon; the count's role and its 13 pt size
both separate it from the 11 pt details. The card draws one chip: the long-episode mark, on
`warning` (`src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:65`). The season chip and its
`warning`/`accent` tone lived in the deleted `AnimeCardSeasonStatus.tsx` and no longer exist anywhere,
but nothing on the card mounts that row any more. The card holds no colour literal: every icon takes
a role class or inherits its button's colour.

## Type scale as written on the card

| Element | Classes / props in code | Citation |
| --- | --- | --- |
| Title | `text-foreground text-base leading-tight`, weight 400 from AppText's `font-normal`, `numberOfLines={2}` | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:56` |
| Meta line, count | `text-reading text-[13px]` on its own span, weight 400 | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:33`–`:35` |
| Meta line, state and note | `text-muted text-[11px]` on their own spans, weight 400 | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:33`–`:35` |
| Every chip | `size="sm" variant="secondary"`; only the long-episode mark is drawn | `src/features/animes/ui/AnimeCard/AnimeCardInfo.tsx:65` |
| Icon-only chrome | `size-10` plus `hitSlop={4}` for chapters, `size="sm"` plus `hitSlop={4}` for shortcuts and CTAs | `src/features/animes/ui/AnimeCard/AnimeCardChapterControls.tsx:33`, `src/features/animes/ui/AnimeCard/AnimeCardShortcuts.tsx:23` |

The card now renders the 16/13/11 scale the proposals page asks for
([proposals](../proposals/anime-cards-and-season-rating.md)): 16 pt for the title, 13 pt for the count
under it and 11 pt for the details, all at weight 400. `text-[13px]` and `text-[11px]` are arbitrary
sizes because neither `text-sm` (14 pt) nor `text-xs` (12 pt) matches the recipe; both arbitrary sizes
are already used elsewhere in the app. This table quotes props and classes; it is not a measurement of
what any device paints.

## Season mode and the rating interaction

The card has **no season-mode branch**. Season mode is read from the pairing row
(`src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts:89`) and changes the default filter
to `Ver hoy` (`src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts:321`,
`src/features/animes/anime.helpers.ts:90`–`:91`) plus a `Modo temporada` chip in the list's status
section (`src/features/animes/ui/AnimeListScreen/AnimeListScreenStatusSection.tsx:20`–`:24`). What
appears on the card is projection-driven: `buildAnimeSeasonProjection` returns `null` unless the anime
is a candidate of the open season (`src/features/animes/anime-season.helpers.ts:55`–`:57`), and
`getAnimeSeasonStatus` returns `null` without a projection
(`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:155`–`:160`). Otherwise it returns `Nota {n}/6`
when the newest local intent or the bridge rating carries a note, and `Sin nota` when the candidate has
none (`:162`–`:169`); `showRatingCta` is always `true`.

Because the note segment reads that same descriptor, the card used to show a season candidate's note
twice: on the meta line and again in a season status row with a description. **That row is gone.**
`AnimeCardInfo` no longer mounts `AnimeCardSeasonStatus`, so the note is drawn exactly once, on the
meta line, and no bridge wording reaches the card. Two things still read `seasonStatus`:

- `getNoteSegmentLabel(seasonStatus)` takes `label` for the note segment
  (`src/features/animes/ui/AnimeCard/anime-card.helpers.ts:59`–`:63`,
  `src/features/animes/ui/AnimeCard/AnimeCard.tsx:36`).
- `AnimeCardActions` reads `showRatingCta`, which is always `true`, to decide whether
the note star is drawn (`src/features/animes/ui/AnimeCard/AnimeCardActions.tsx:38`, passed to `src/features/animes/ui/AnimeCard/AnimeCardShortcuts.tsx:43`).

`description` and `tone` were removed from `getAnimeSeasonStatus` and from
`AnimeSeasonStatusDescriptor`. The component that drew them, `AnimeCardSeasonStatus.tsx`, was deleted
in the same change, so no dead component and no unrendered field remain
(`src/features/animes/ui/AnimeCard/anime-card.types.ts:70`–`:73`).

Rating today: the note star calls `onOpenSeasonRatingSheet` with the anime id
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
  line are read from props and class names (`META_TOGGLE_HIT_SLOP`, `hitSlop={8}`, `hitSlop={4}`, no
  `numberOfLines`); nothing here measured a device.
- **No responsive claim for the card.** `AnimeCardProps` carries no layout mode
  (`src/features/animes/ui/AnimeCard/anime-card.types.ts:5`–`:24`), so the card does not change its own
  composition per mode; only the cell around it does
  (`src/features/animes/ui/AnimeListScreen/AnimeListScreenContent.tsx:32`).
- **No claim about native appearance.** The season row was removed, so the note is drawn once; that
  is a code fact. Nothing here proves how the resulting card looks on a device.
- **No claim that the whole proposals page is implemented.** The 16/13/11 type scale, the note star, the
  removal of the `Temporada` button and the neutral decrease control are on the card from these changes
  on. Both chapter icons take their colour from the role of the button they sit in, so no literal white
  is left in that row.
