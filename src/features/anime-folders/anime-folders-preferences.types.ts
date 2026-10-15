/** Anime-folders settings kept in the `app_preferences` singleton row. */
export interface AnimeFoldersPreferences {
  /** SAF tree uri of the chosen anime root, or `null` before the user picks one. */
  readonly rootUri: string | null;
  /** When the user dismissed the hint banner with "Ahora no", or `null` if never. */
  readonly hintDismissedAt: number | null;
}
