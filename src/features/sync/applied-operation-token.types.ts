/** One confirmed bridge token ready to persist onto its `animes` row. */
export interface ConfirmedAnimeToken {
  readonly animeId: string;
  readonly bridgeModifiedAt: number;
}
