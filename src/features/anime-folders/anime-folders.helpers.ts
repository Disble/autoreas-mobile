import {
  ANIME_FOLDERS_MAX_DEPTH,
  COMBINING_MARKS_PATTERN,
  DOCUMENT_SEGMENT,
  NON_ALPHANUMERIC_PATTERN,
  NON_LATIN_LETTER_PATTERN,
  OPENABLE_PAGE_URL_PATTERN,
  PRIMARY_STORAGE_PATH,
  PRIMARY_VOLUME_ID,
  PRIMARY_VOLUME_LABEL,
  REMOVABLE_VOLUME_LABEL,
  ROOT_LABEL_SEPARATOR,
  TREE_SEGMENT,
} from './anime-folders.constants';
import type {
  AnimeFolderSource,
  FolderClaim,
  FolderIndex,
  FolderIndexSummary,
  FolderResolution,
  FolderTreeEntry,
  FolderTreeLister,
  IndexedFolder,
  ResolvedAnimeFolder,
  YieldToUi,
} from './anime-folders.types';

/** Splits a path on `/` or `\`, dropping empty and blank segments. */
function toSegments(path: string | null | undefined): string[] {
  return (path ?? '')
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/** Decodes a percent-encoded uri segment, dropping trailing slashes. */
function decodeSegment(value: string): string {
  return decodeURIComponent(value.replace(/\/+$/, ''));
}

/** Extracts the decoded SAF document id from a tree or child document uri. */
export function getSafDocumentId(uri: string): string | null {
  const documentIndex = uri.indexOf(DOCUMENT_SEGMENT);
  if (documentIndex >= 0) {
    return decodeSegment(uri.slice(documentIndex + DOCUMENT_SEGMENT.length));
  }

  const treeIndex = uri.indexOf(TREE_SEGMENT);
  if (treeIndex >= 0) {
    return decodeSegment(uri.slice(treeIndex + TREE_SEGMENT.length));
  }

  return null;
}

/** Splits a document id into its volume and its path below the volume. */
function splitDocumentId(documentId: string): { volume: string; path: string } | null {
  const colonIndex = documentId.indexOf(':');
  if (colonIndex <= 0) {
    return null;
  }

  return {
    volume: documentId.slice(0, colonIndex),
    path: toSegments(documentId.slice(colonIndex + 1)).join('/'),
  };
}

/** Maps a SAF document id to the absolute device path a file manager understands. */
export function toDeviceStoragePath(documentId: string): string | null {
  const parts = splitDocumentId(documentId);
  if (!parts) {
    return null;
  }

  const base =
    parts.volume === PRIMARY_VOLUME_ID ? PRIMARY_STORAGE_PATH : `/storage/${parts.volume}`;
  return parts.path ? `${base}/${parts.path}` : base;
}

/** Builds the breadcrumb label of a picked root, e.g. `SD card › Videos › Anime`. */
export function formatRootLabel(rootUri: string): string {
  const documentId = getSafDocumentId(rootUri);
  const parts = documentId ? splitDocumentId(documentId) : null;
  if (!parts) {
    return rootUri;
  }

  const volumeLabel =
    parts.volume === PRIMARY_VOLUME_ID ? PRIMARY_VOLUME_LABEL : REMOVABLE_VOLUME_LABEL;
  return [volumeLabel, ...toSegments(parts.path)].join(ROOT_LABEL_SEPARATOR);
}

/** Exact-match key: same characters, ignoring case and surrounding spaces. */
function toExactKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}

/**
 * Normalized-match key: latin letters and digits only, without accents. Empty, so it never
 * matches, when nothing is left or when the name has non-latin letters the key would drop.
 */
function toNormalizedKey(name: string): string {
  const unaccented = name.normalize('NFKD').replace(COMBINING_MARKS_PATTERN, '');
  if (NON_LATIN_LETTER_PATTERN.test(unaccented)) {
    return '';
  }

  return unaccented.toLowerCase().replace(NON_ALPHANUMERIC_PATTERN, '');
}

/**
 * Walks a SAF folder tree level by level, up to `ANIME_FOLDERS_MAX_DEPTH` levels, and returns
 * every folder found. Files and hidden folders (names starting with `.`) are skipped. Listings are
 * synchronous native calls, so the walk yields to the UI before each one instead of freezing it
 * for the whole tree; a listing that throws (access lost) rejects the walk.
 */
export async function walkFolderTree(
  rootUri: string,
  listChildren: FolderTreeLister,
  yieldToUi: YieldToUi,
): Promise<FolderTreeEntry[]> {
  const found: FolderTreeEntry[] = [];
  let level: { uri: string; relativePath: string }[] = [{ uri: rootUri, relativePath: '' }];

  for (let depth = 1; depth <= ANIME_FOLDERS_MAX_DEPTH; depth += 1) {
    const nextLevel: { uri: string; relativePath: string }[] = [];

    for (const parent of level) {
      // eslint-disable-next-line react-doctor/async-await-in-loop -- sequential by design: each yield lets the UI run between two blocking native listings.
      await yieldToUi();

      for (const child of listChildren(parent.uri)) {
        const documentId = getSafDocumentId(child.uri);
        const name = toSegments(documentId?.slice(documentId.indexOf(':') + 1)).at(-1);
        if (!child.isDirectory || !documentId || !name || name.startsWith('.')) {
          continue;
        }

        const relativePath = parent.relativePath ? `${parent.relativePath}/${name}` : name;
        found.push({ relativePath, documentId });
        nextLevel.push({ uri: child.uri, relativePath });
      }
    }

    level = nextLevel;
  }

  return found;
}

/** Appends a folder to the group stored under `key`, skipping empty keys. */
function addToGroup(groups: Map<string, IndexedFolder[]>, key: string, folder: IndexedFolder): void {
  if (key) {
    groups.set(key, [...(groups.get(key) ?? []), folder]);
  }
}

/** Builds the folder index with exact-name and normalized-name lookups. */
export function buildFolderIndex(entries: readonly FolderTreeEntry[]): FolderIndex {
  const folders: IndexedFolder[] = [];
  const byExactKey = new Map<string, IndexedFolder[]>();
  const byNormalizedKey = new Map<string, IndexedFolder[]>();

  for (const entry of entries) {
    const folder: IndexedFolder = {
      name: toSegments(entry.relativePath).at(-1) ?? entry.relativePath,
      relativePath: entry.relativePath,
      devicePath: toDeviceStoragePath(entry.documentId),
    };
    folders.push(folder);
    addToGroup(byExactKey, toExactKey(folder.name), folder);
    addToGroup(byNormalizedKey, toNormalizedKey(folder.name), folder);
  }

  return { folders, byExactKey, byNormalizedKey };
}

/**
 * Finds the folder whose path below the device root and the bridge path below the library root
 * end the same way, so a root picked at a different level still matches. The longest shared tail
 * wins; a tie between folders is ambiguous. Returns `undefined` when no folder is related.
 */
function matchByPath(index: FolderIndex, folderRelative: string | null | undefined): IndexedFolder[] | undefined {
  const bridgeKeys = toSegments(folderRelative).map(toExactKey);
  if (bridgeKeys.length === 0) {
    return undefined;
  }

  let best: IndexedFolder[] = [];
  let bestLength = 0;

  for (const folder of index.folders) {
    const folderKeys = toSegments(folder.relativePath).map(toExactKey);
    const length = Math.min(folderKeys.length, bridgeKeys.length);
    const isRelated = folderKeys
      .slice(-length)
      .every((key, offset) => key === bridgeKeys[bridgeKeys.length - length + offset]);

    if (!isRelated || length < bestLength) {
      continue;
    }

    best = length > bestLength ? [folder] : [...best, folder];
    bestLength = length;
  }

  return best.length > 0 ? best : undefined;
}

/**
 * Resolves one anime: bridge path, then exact folder name, then normalized name. The first step
 * that finds anything decides; more than one folder there means ambiguous, so nothing resolves.
 */
function resolveOne(index: FolderIndex, source: AnimeFolderSource): ResolvedAnimeFolder | null {
  const name = toSegments(source.carpeta).at(-1);
  const steps: [ResolvedAnimeFolder['method'], readonly IndexedFolder[] | undefined][] = [
    ['path', matchByPath(index, source.folderRelative)],
    ['exact', name ? index.byExactKey.get(toExactKey(name)) : undefined],
    ['normalized', name ? index.byNormalizedKey.get(toNormalizedKey(name)) : undefined],
  ];

  for (const [method, matches] of steps) {
    if (matches && matches.length > 0) {
      return matches.length === 1 ? { folder: matches[0], method } : null;
    }
  }

  return null;
}

/** True when `path` is strictly below `ancestor`. */
function isWithin(path: string, ancestor: string): boolean {
  return path.startsWith(`${ancestor}/`);
}

/** Groups the animes by the folder each one resolves to, keyed by the folder's relative path. */
function claimFolders(index: FolderIndex, animes: readonly AnimeFolderSource[]): Map<string, FolderClaim> {
  const claims = new Map<string, FolderClaim>();

  for (const source of animes) {
    const resolved = resolveOne(index, source);
    if (resolved) {
      const claim = claims.get(resolved.folder.relativePath) ?? { resolved, animeIds: [] };
      claim.animeIds.push(source.id);
      claims.set(resolved.folder.relativePath, claim);
    }
  }

  return claims;
}

/** Sorts every indexed folder into matched, shared, or unmatched, in index order. */
function summarizeClaims(index: FolderIndex, claims: ReadonlyMap<string, FolderClaim>): FolderIndexSummary {
  const matchedFolders: ResolvedAnimeFolder[] = [];
  const sharedFolders: IndexedFolder[] = [];
  const candidates: IndexedFolder[] = [];

  for (const folder of index.folders) {
    const claim = claims.get(folder.relativePath);
    if (!claim) {
      candidates.push(folder);
    } else if (claim.animeIds.length === 1) {
      matchedFolders.push(claim.resolved);
    } else {
      sharedFolders.push(folder);
    }
  }

  // A folder inside or around a matched one is that anime's content or container, and a folder
  // inside an unmatched or shared one is already covered by it: neither is a finding of its own.
  const unmatchedFolders = candidates.filter(
    (folder) =>
      !matchedFolders.some(
        ({ folder: matched }) =>
          isWithin(folder.relativePath, matched.relativePath) ||
          isWithin(matched.relativePath, folder.relativePath),
      ) &&
      ![...candidates, ...sharedFolders].some((outer) => isWithin(folder.relativePath, outer.relativePath)),
  );

  return {
    folderCount: index.folders.length,
    animesWithFolder: matchedFolders.length,
    matchedFolders,
    sharedFolders,
    unmatchedFolders,
  };
}

/**
 * Resolves every anime against the index and summarizes the result. A folder more than one anime
 * resolves to gives none of them the button, so the user can tell them apart on the PC.
 */
export function resolveAnimeFolders(
  index: FolderIndex,
  animes: readonly AnimeFolderSource[],
): FolderResolution {
  const claims = claimFolders(index, animes);
  const byAnimeId = new Map<string, ResolvedAnimeFolder>();

  for (const { resolved, animeIds } of claims.values()) {
    if (animeIds.length === 1) {
      byAnimeId.set(animeIds[0], resolved);
    }
  }

  return { byAnimeId, summary: summarizeClaims(index, claims) };
}

/** Returns the anime page url when it is an http(s) url with a host, else `null` (no page button). */
export function getOpenablePageUrl(pagina: string | null | undefined): string | null {
  const trimmed = (pagina ?? '').trim();
  return OPENABLE_PAGE_URL_PATTERN.test(trimmed) ? trimmed : null;
}
