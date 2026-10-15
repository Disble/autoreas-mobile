import { Directory } from 'expo-file-system';
import type { FolderTreeChild } from './anime-folders.types';

/** Lists the direct children of a SAF folder; throws when access was lost. */
export function listSafChildren(uri: string): FolderTreeChild[] {
  return new Directory(uri).list().map((entry) => ({
    uri: entry.uri,
    isDirectory: entry instanceof Directory,
  }));
}

/** True when the persisted SAF root still exists and is readable (SD card present, grant kept). */
export function isSafRootReadable(uri: string): boolean {
  try {
    return new Directory(uri).exists;
  } catch {
    return false;
  }
}

/** Waits one macrotask so pending touches and frames run before the next blocking listing. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
