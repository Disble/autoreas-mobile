import type { EpisodeLength } from '../../../../infrastructure/validation/anime-schema';
import type { AnimeSeasonProjection } from '../../anime-season.types';
import { META_SEPARATOR, STATE_CHIP_BY_ESTADO } from './anime-card.constants';
import type {
  AnimeCardMetaParams,
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
 * Builds the single meta line under the card title: the count, then the state, then the note.
 * The state is always part of the line, so `En pausa` can no longer fall out of it, and while the
 * toggle is on only the count segment becomes the remaining form instead of replacing the line.
 */
export function getAnimeCardMetaLabel(params: AnimeCardMetaParams): string {
  const { nrocapvisto, stateLabel, noteLabel, restantesLabel, restantesShown } = params;
  const countLabel =
    restantesShown && restantesLabel ? restantesLabel : getWatchedCountLabel(nrocapvisto);

  return composeMetaLine([countLabel, stateLabel, noteLabel]);
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

  if (seasonProjection.localIntent?.status === 'failed') {
    return {
      label: `Pendiente ${seasonProjection.localIntent.nota}/6`,
      showRatingCta: true,
    };
  }

  if (seasonProjection.localIntent?.status === 'pending') {
    return {
      label: `Pendiente ${seasonProjection.localIntent.nota}/6`,
      showRatingCta: true,
    };
  }

  if (seasonProjection.bridgeRating != null) {
    return {
      label: `Nota ${seasonProjection.bridgeRating}/6`,
      showRatingCta: true,
    };
  }

  return {
    label: 'Sin nota',
    showRatingCta: true,
  };
}
