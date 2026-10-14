import type { EpisodeLength } from '../../../../infrastructure/validation/anime-schema';
import type { AnimeSeasonProjection } from '../../anime-season.types';
import { STATE_CHIP_BY_ESTADO } from './anime-card.constants';
import type { AnimeSeasonStatusDescriptor, AnimeStateChipDescriptor } from './anime-card.types';

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
 * Maps the legacy `estado` integer into the chip descriptor shown at the card header.
 * Unknown values fall back to "Viendo" so corrupt rows never break the UI.
 * The `isDefault` flag lets the card render Viendo implicitly (no chip noise on the happy path).
 */
export function getStateChip(estado: number): AnimeStateChipDescriptor {
  return STATE_CHIP_BY_ESTADO[estado] ?? STATE_CHIP_BY_ESTADO[0];
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
      description: 'Requiere reparación en bridge',
      tone: 'warning',
      showRatingCta: true,
    };
  }

  if (seasonProjection.localIntent?.status === 'pending') {
    return {
      label: `Pendiente ${seasonProjection.localIntent.nota}/6`,
      description: 'Esperando confirmación del bridge',
      tone: 'warning',
      showRatingCta: true,
    };
  }

  if (seasonProjection.bridgeRating != null) {
    return {
      label: `Temporada ${seasonProjection.bridgeRating}/6`,
      description: 'Confirmado por bridge',
      tone: 'accent',
      showRatingCta: true,
    };
  }

  return {
    label: 'Sin nota de temporada',
    description: 'Disponible para calificar',
    tone: 'accent',
    showRatingCta: true,
  };
}
