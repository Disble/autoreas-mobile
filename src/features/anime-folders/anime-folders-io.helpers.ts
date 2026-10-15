import { Directory } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';
import { Alert, Linking } from 'react-native';
import {
  FLAG_ACTIVITY_LAUNCH_ADJACENT,
  FLAG_ACTIVITY_NEW_TASK,
  OPEN_FOLDER_FAILED_TITLE,
  OPEN_PAGE_FAILED_TITLE,
  SAMSUNG_MY_FILES_LAUNCH_ACTION,
  SAMSUNG_MY_FILES_START_PATH_EXTRA,
} from './anime-folders.constants';
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

/**
 * Opens the system folder picker at `initialUri`; the picker takes the persistable read grant.
 * Resolves `null` when the user cancels, so nothing changes.
 */
export async function pickSafRoot(initialUri: string): Promise<string | null> {
  try {
    const directory = await Directory.pickDirectoryAsync(initialUri);
    return directory.uri;
  } catch {
    return null;
  }
}

/**
 * Opens a device folder in Samsung My Files. In split screen it opens in the other half, reusing
 * the My Files already there; from full screen it opens full screen.
 */
export function openDeviceFolder(path: string): void {
  startActivityAsync(SAMSUNG_MY_FILES_LAUNCH_ACTION, {
    extra: { [SAMSUNG_MY_FILES_START_PATH_EXTRA]: path },
    flags: FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_LAUNCH_ADJACENT,
  }).catch((error: unknown) => {
    Alert.alert(OPEN_FOLDER_FAILED_TITLE, String(error));
  });
}

/** Opens an anime page in the browser. */
export function openPageUrl(url: string): void {
  Linking.openURL(url).catch((error: unknown) => {
    Alert.alert(OPEN_PAGE_FAILED_TITLE, String(error));
  });
}
