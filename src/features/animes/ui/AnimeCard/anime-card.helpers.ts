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
