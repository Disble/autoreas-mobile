/** One child entry returned by a folder listing: its SAF uri and whether it is a folder. */
export interface FolderTreeChild {
  readonly uri: string;
  readonly isDirectory: boolean;
}

/** Lists the direct children of a folder; rejects when access was lost. */
export type FolderTreeLister = (uri: string) => Promise<readonly FolderTreeChild[]>;


/** A folder found while walking the anime root. */
export interface FolderTreeEntry {
  /** `/`-separated path below the root, e.g. `One Pace - Whole Cake Island/One Pace - Wano`. */
  readonly relativePath: string;
  /** Decoded SAF document id, e.g. `0123-4567:Videos/Anime/Bleach`. */
  readonly documentId: string;
}

/** A folder in the index, ready to be opened in the file manager. */
export interface IndexedFolder {
  readonly name: string;
  readonly relativePath: string;
  /** Absolute device path for the file manager, or `null` if the volume is unknown. */
  readonly devicePath: string | null;
}

/** An anime folder source with the stamp of its last remote change, so a new incoming event is visible. */
export interface AnimeFolderArrivalSource extends AnimeFolderSource {
  /** `last_applied_change_ms`: changes every time a remote change of this anime is applied. */
  readonly lastAppliedChangeMs: number | null;
}

/**
 * Where the folders of pending animes are expected: the indexed folder to list (`''` is the root)
 * and the exact-match keys of the folder names that would appear in it.
 */
export interface FolderProbe {
  readonly parentRelativePath: string;
  readonly expectedKeys: readonly string[];
}

/** The indexed folders below the root, with lookups by exact and by normalized folder name. */
export interface FolderIndex {
  readonly folders: readonly IndexedFolder[];
  readonly byExactKey: ReadonlyMap<string, readonly IndexedFolder[]>;
  readonly byNormalizedKey: ReadonlyMap<string, readonly IndexedFolder[]>;
}

/** How an anime found its folder: bridge path, exact name, or normalized name. */
export type FolderMatchMethod = 'path' | 'exact' | 'normalized';

/** The anime fields the resolution reads. */
export interface AnimeFolderSource {
  readonly id: string;
  /** PC folder path from the bridge (`folder` on the wire). */
  readonly carpeta: string | null | undefined;
  /** Path below the bridge library root (`folderRelative` on the wire). */
  readonly folderRelative: string | null | undefined;
  /** `1` for an anime the list shows; `0` for an inactive one, which stays a row but has no card. */
  readonly activo: number;
}

/** The folder one anime opens, and how it was found. */
export interface ResolvedAnimeFolder {
  readonly folder: IndexedFolder;
  readonly method: FolderMatchMethod;
}

/** One folder and the animes that resolved to it. */
export interface FolderClaim {
  readonly resolved: ResolvedAnimeFolder;
  /** Active animes only: they decide who gets the button and whether the folder is shared. */
  readonly activeAnimeIds: string[];
}

/** Totals and lists for the Settings card and the folder detail screen. */
export interface FolderIndexSummary {
  readonly folderCount: number;
  readonly animesWithFolder: number;
  /** Folders some anime uses and no two active animes share, in index order. */
  readonly matchedFolders: readonly ResolvedAnimeFolder[];
  /** Folders more than one active anime resolves to; none of those animes gets the button. */
  readonly sharedFolders: readonly IndexedFolder[];
  /** Folders no anime opens, leaving out folders inside or around a matched one. */
  readonly unmatchedFolders: readonly IndexedFolder[];
}

/** Result of resolving every anime against the folder index. */
export interface FolderResolution {
  readonly byAnimeId: ReadonlyMap<string, ResolvedAnimeFolder>;
  readonly summary: FolderIndexSummary;
}

/** Lifecycle of the folder index for the chosen root. */
export type AnimeFoldersIndexStatus = 'idle' | 'indexing' | 'ready' | 'lost';

/** Shared folder index state; `index` keeps the last known index while a refresh runs. */
export interface AnimeFoldersIndexState {
  readonly rootUri: string | null;
  readonly status: AnimeFoldersIndexStatus;
  readonly index: FolderIndex | null;
  readonly indexedAt: number | null;
}

/** What the anime-folders hook exposes to screens. */
export interface AnimeFoldersView extends AnimeFoldersIndexState {
  /** False until the stored preferences have been read. */
  readonly isLoaded: boolean;
  /** Breadcrumb label of the chosen root, e.g. `SD card › Videos › Anime`. */
  readonly rootLabel: string | null;
  readonly hintDismissedAt: number | null;
  /** Re-reads the chosen root and rebuilds the index. */
  readonly reindex: () => void;
  /**
   * Opens the system picker, stores the chosen root and indexes it. Resolves the chosen uri, or
   * `null` when the user cancelled or the root could not be saved.
   */
  readonly chooseRoot: () => Promise<string | null>;
  /** Hides the hint banner for good. */
  readonly dismissHint: () => void;
}

/** The native `SafLister` module (modules/saf-lister). */
export interface SafListerModule {
  readonly listChildren: (uri: string) => Promise<FolderTreeChild[]>;
}

/** The native `ActivityLauncher` module (modules/activity-launcher). */
export interface ActivityLauncherModule {
  /** Resolves once Android accepted the launch; never waits for the started activity. */
  readonly startActivity: (
    action: string,
    extras: Readonly<Record<string, string>>,
    flags: number,
  ) => Promise<void>;
}
