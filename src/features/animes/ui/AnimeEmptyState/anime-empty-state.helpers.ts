/**
 * Returns a normalized empty-state payload for presentation hooks and components.
 * Keeping this formatter pure makes it safe to reuse when empty-state copy evolves.
 */
export const formatAnimeEmptyStateData = <T>(data: T) => {
  return data;
};
