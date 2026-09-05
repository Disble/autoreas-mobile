import type { Anime } from './anime.schema';

/**
 * Transport-level pair: the domain `Anime` alongside the bridge OCC token, kept OUTSIDE the
 * domain shape (invariant 5). `mapWireAnimeToLegacyAnime` stays a 1:1 mapper untouched -- this
 * is a sibling that composes it, never a replacement.
 */
export interface IngestedAnime {
  readonly anime: Anime;
  readonly bridgeModifiedAt: number;
}
