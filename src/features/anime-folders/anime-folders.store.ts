import { INITIAL_ANIME_FOLDERS_INDEX_STATE } from './anime-folders.constants';
import { buildFolderIndex, walkFolderTree } from './anime-folders.helpers';
import { isSafRootReadable, listSafChildren, yieldToUi } from './anime-folders-io.helpers';
import type { AnimeFoldersIndexState } from './anime-folders.types';

/** Current index state; replaced on every change so `useSyncExternalStore` sees new snapshots. */
let state: AnimeFoldersIndexState = INITIAL_ANIME_FOLDERS_INDEX_STATE;
/** The index run in flight, shared by every caller asking for the same root meanwhile. */
let inFlight: { rootUri: string; promise: Promise<void> } | null = null;
/** Subscribers notified on every state change. */
const listeners = new Set<() => void>();

/** Merges a patch into the state and notifies subscribers. */
function setState(patch: Partial<AnimeFoldersIndexState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) {
    listener();
  }
}

/** Subscribes to index state changes (for `useSyncExternalStore`). */
export function subscribeAnimeFoldersIndex(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Returns the current index state snapshot. */
export function getAnimeFoldersIndexState(): AnimeFoldersIndexState {
  return state;
}

/** Walks the root and publishes the result, unless the root changed while it ran. */
async function runIndex(rootUri: string): Promise<void> {
  setState({ status: 'indexing' });

  try {
    if (!isSafRootReadable(rootUri)) {
      throw new Error('anime root is not readable');
    }

    const startedAt = Date.now();
    const entries = await walkFolderTree(rootUri, listSafChildren, yieldToUi);
    if (state.rootUri === rootUri) {
      setState({ status: 'ready', index: buildFolderIndex(entries), indexedAt: Date.now() });
      console.info('[anime-folders] indexed', { folders: entries.length, ms: Date.now() - startedAt });
    }
  } catch (error) {
    if (state.rootUri === rootUri) {
      setState({ status: 'lost', index: null, indexedAt: null });
      console.warn('[anime-folders] index failed', error);
    }
  }
}

/**
 * Indexes the chosen root. A run already in flight for the same root is shared instead of
 * starting a second walk, and a root already indexed is left alone unless `force` asks for a
 * refresh. While a refresh runs, the last known index stays available. A `null` root clears it.
 */
export function indexAnimeFolders(rootUri: string | null, force = false): Promise<void> {
  if (!rootUri) {
    setState(INITIAL_ANIME_FOLDERS_INDEX_STATE);
    return Promise.resolve();
  }

  if (state.rootUri !== rootUri) {
    setState({ ...INITIAL_ANIME_FOLDERS_INDEX_STATE, rootUri });
  }

  if (inFlight?.rootUri === rootUri) {
    if (state.status === 'idle') {
      setState({ status: 'indexing' });
    }

    return inFlight.promise;
  }

  if (state.status !== 'idle' && !force) {
    return Promise.resolve();
  }

  const run = { rootUri, promise: Promise.resolve() };
  run.promise = runIndex(rootUri).finally(() => {
    if (inFlight === run) {
      inFlight = null;
    }
  });
  inFlight = run;
  return run.promise;
}

/**
 * Cheap access check for when the app returns to the foreground: marks the root lost when the SD
 * card or the grant is gone, and re-indexes when a lost root became readable again.
 */
export function recheckAnimeFoldersAccess(): Promise<void> {
  const { rootUri, status } = state;
  if (!rootUri || inFlight) {
    return Promise.resolve();
  }

  const isReadable = isSafRootReadable(rootUri);
  if (!isReadable && status !== 'lost') {
    setState({ status: 'lost', index: null, indexedAt: null });
  }

  return isReadable && status === 'lost' ? indexAnimeFolders(rootUri, true) : Promise.resolve();
}
