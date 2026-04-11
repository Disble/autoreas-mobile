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

export type AnimeStateChipTone = 'accent' | 'success' | 'warning' | 'danger';

export interface AnimeStateChipDescriptor {
  readonly label: string;
  readonly tone: AnimeStateChipTone;
  readonly isDefault: boolean;
}

export const CHIP_TONE_COLOR_MAP: Readonly<Record<AnimeStateChipTone, 'accent' | 'success' | 'warning' | 'danger'>> = {
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

const STATE_CHIP_BY_ESTADO: Readonly<Record<number, AnimeStateChipDescriptor>> = {
  0: { label: 'Viendo', tone: 'accent', isDefault: true },
  1: { label: 'Finalizado', tone: 'success', isDefault: false },
  2: { label: 'No me gustó', tone: 'danger', isDefault: false },
  3: { label: 'En pausa', tone: 'warning', isDefault: false },
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
