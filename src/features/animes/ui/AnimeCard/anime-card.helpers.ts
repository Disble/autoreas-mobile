import type { EpisodeLength } from '../../../../infrastructure/validation/anime-schema';
import type { AnimeSeasonProjection } from '../../anime-season.types';
import { META_SEPARATOR, STATE_CHIP_BY_ESTADO } from './anime-card.constants';
import type {
  AnimeCardMetaParams,
  AnimeCardMetaSegment,
  AnimeSeasonStatusDescriptor,
  AnimeStateChipDescriptor,
} from './anime-card.types';

/**
 * Locks chapter mutations when the anime is already marked as Finalizado in domain state.
 * This prevents the UI from offering Cap+ or Cap- actions that contradict the persisted business status.
 */
export const isAnimeMutationLocked = (estado: number) => {
  return estado !== 0;
};

/**
 * Checks whether the watched episode count can be decremented without going below zero.
 * This protects the minus action from producing impossible negative progress.
 */
export const canDecrease = (nrocapvisto: number) => {
  return nrocapvisto > 0;
};

/**
 * Checks whether the watched episode count can be incremented for the current anime.
 * It allows increments while the total is unknown and blocks them once the known total is reached.
 */
export const canIncrease = (nrocapvisto: number, totalcap: number | null | undefined) => {
  return totalcap == null || nrocapvisto < totalcap;
};

/**
 * Maps the legacy `estado` integer into the state descriptor shown on the card.
 * Unknown values fall back to "Viendo" so corrupt rows never break the UI.
 * The `isDefault` flag is kept for callers that still need to tell Viendo apart from the states
 * that ask for attention; the card now renders the label for every state.
 */
export function getStateChip(estado: number): AnimeStateChipDescriptor {
  return STATE_CHIP_BY_ESTADO[estado] ?? STATE_CHIP_BY_ESTADO[0];
}

/**
 * Builds the watched-episode segment of the meta line. It keeps the singular for exactly one
 * chapter and preserves fractional counts instead of rounding a half-watched chapter away.
 */
export function getWatchedCountLabel(nrocapvisto: number): string {
  return nrocapvisto === 1 ? '1 capítulo visto' : `${nrocapvisto} capítulos vistos`;
}

/**
 * Reads the note segment out of the season status: `Nota 3/6` for a confirmed rating, `Pendiente 4/6`
 * for a local intent and `Sin nota` for an ungraded candidate.
 * Returns null when the anime has no season candidacy at all, so the card shows the state alone
 * rather than a note it cannot express.
 */
export function getNoteSegmentLabel(
  seasonStatus: AnimeSeasonStatusDescriptor | null | undefined,
): string | null {
  return seasonStatus ? seasonStatus.label : null;
}

/**
 * Joins the meta segments with the dot separator, dropping the absent and blank ones first.
 * Dropping before joining is what keeps a separator from ever leading, trailing or doubling.
 */
export function composeMetaLine(segments: readonly (string | null | undefined)[]): string {
  const present = segments.reduce<string[]>((kept, segment) => {
    const trimmed = segment?.trim();
    if (trimmed) {
      kept.push(trimmed);
    }
    return kept;
  }, []);

  return present.join(META_SEPARATOR);
}

/**
 * Builds the meta line as ordered segments, each carrying its own text and kind: the count first, then
 * the state, then the note. Absent and blank segments are dropped here, so the view can only ever draw
 * a separator between two segments that carry text.
 * While the toggle is on only the count segment changes its text to the remaining form; the state and
 * the note stay where they are.
 */
export function getAnimeCardMetaSegments(
  params: AnimeCardMetaParams,
): AnimeCardMetaSegment[] {
  const { nrocapvisto, stateLabel, noteLabel, restantesLabel, restantesShown } = params;
  const countLabel =
    restantesShown && restantesLabel ? restantesLabel : getWatchedCountLabel(nrocapvisto);

  const segments: AnimeCardMetaSegment[] = [
    { kind: 'count', text: countLabel },
    { kind: 'state', text: stateLabel },
    { kind: 'note', text: noteLabel ?? '' },
  ];

  return segments.filter((segment) => Boolean(segment.text.trim()));
}

/**
 * Builds the whole meta line as one string: the count, the state and the note joined by the dot
 * separator. It is the accessible label of the toggling control and the value the tests assert, and
 * it is composed from the same segments the view draws, so label and render cannot drift apart.
 */
export function getAnimeCardMetaLabel(params: AnimeCardMetaParams): string {
  return composeMetaLine(getAnimeCardMetaSegments(params).map((segment) => segment.text));
}

/**
 * Builds the "X restantes" label shown when the user taps the progress counter.
 * Returns null whenever the total is unknown or the anime has no remaining episodes.
 */
export function getRestantesLabel(
  nrocapvisto: number,
  totalcap: number | null | undefined,
): string | null {
  if (totalcap == null || totalcap <= 0) {
    return null;
  }

  const remaining = totalcap - Math.floor(nrocapvisto);
  if (remaining <= 0) {
    return null;
  }

  return `${remaining} restantes`;
}

/**
 * Builds the long-episode mark for the next episode to watch: the entry whose `episode` is
 * `nrocapvisto + 1` and that the bridge flagged `long`. A fractional count has no next episode,
 * so it matches no entry and shows no mark. Mobile never decides what "long" means; it only reads the bridge's flag.
 */
export function getLongEpisodeLabel(
  episodes: readonly EpisodeLength[] | null | undefined,
  nrocapvisto: number,
): string | null {
  // A fractional count (6.5) looks for episode 7.5, which no entry has: no mark, by construction.
  const next = episodes?.find((entry) => entry.episode === nrocapvisto + 1);
  if (!next?.long) {
    return null;
  }

  return `Ep. ${next.episode} · ${next.minutes} min`;
}

/**
 * Builds the season badge/copy shown on each anime card.
 * Confirmed bridge rating and local pending or failed intent stay separated so users never confuse one for the other.
 */
export function getAnimeSeasonStatus(
  seasonProjection: AnimeSeasonProjection | null | undefined,
): AnimeSeasonStatusDescriptor | null {
  if (!seasonProjection) {
    return null;
  }

  // The note is a value of the anime, never a sync state: a local intent is the newest choice, so it
  // wins over the bridge value, and sync health is reported once above the list rather than here.
  const note = seasonProjection.localIntent?.nota ?? seasonProjection.bridgeRating;

  return {
    label: note == null ? 'Sin nota' : `Nota ${note}/6`,
    showRatingCta: true,
  };
}
