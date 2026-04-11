/**
 * Calculates the watched progress percentage so the card can render completion UI consistently.
 * Returns null when the total episode count is unknown or invalid to avoid misleading progress bars.
 */
export const calculateProgress = (nrocapvisto: number, totalcap: number | null | undefined) => {
  return totalcap && totalcap > 0 ? Math.round((nrocapvisto / totalcap) * 100) : null;
};

/**
 * Determines whether the anime should be treated as completed for badge and CTA states.
 * This keeps completion logic in one helper so UI and hooks share the same threshold.
 */
export const getIsCompleted = (progress: number | null) => {
  return progress !== null && progress >= 100;
};

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

const WEEKDAY_SHORT_CODE: Readonly<Record<string, string>> = {
  Lunes: 'L',
  Martes: 'M',
  Miércoles: 'X',
  Jueves: 'J',
  Viernes: 'V',
  Sábado: 'S',
  Domingo: 'D',
};

/**
 * Maps a weekday to the single-letter chip label used across the legacy desktop app.
 * Pseudo-days (Sin ver / Ver hoy / Visto) return null so the card can skip non-schedule rows.
 */
export function getDayChipLabel(dia: string): string | null {
  return WEEKDAY_SHORT_CODE[dia] ?? null;
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
