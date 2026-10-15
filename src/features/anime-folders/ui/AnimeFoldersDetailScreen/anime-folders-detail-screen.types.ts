/** One folder an anime opens, with how it was matched. */
export interface AnimeFoldersDetailMatchedRow {
  readonly name: string;
  readonly methodLabel: string;
}

/** Totals and lists of the read-only folder detail screen (canvas 08). */
export interface AnimeFoldersDetailView {
  readonly totals: {
    readonly folders: number;
    readonly withAnime: number;
    readonly withoutAnime: number;
  };
  readonly unmatchedTitle: string;
  readonly unmatchedFolders: readonly string[];
  readonly sharedTitle: string;
  readonly sharedFolders: readonly string[];
  readonly matchedTitle: string;
  readonly matchedFolders: readonly AnimeFoldersDetailMatchedRow[];
}

/** Defines the data contract for the dumb detail content. */
export interface AnimeFoldersDetailContentProps {
  readonly rootLabel: string | null;
  /** `null` until a folder index exists; the screen then shows `statusLabel` only. */
  readonly view: AnimeFoldersDetailView | null;
  readonly statusLabel: string;
  readonly isWide: boolean;
}
