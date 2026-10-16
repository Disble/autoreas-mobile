import { Directory } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Alert, Linking } from 'react-native';
import {
  FLAG_ACTIVITY_LAUNCH_ADJACENT,
  FLAG_ACTIVITY_NEW_TASK,
  OPEN_FOLDER_FAILED_TITLE,
  OPEN_PAGE_FAILED_TITLE,
  SAMSUNG_MY_FILES_LAUNCH_ACTION,
  SAF_LISTER_MODULE_NAME,
  SAMSUNG_MY_FILES_START_PATH_EXTRA,
} from './anime-folders.constants';
import type { FolderTreeChild, SafListerModule } from './anime-folders.types';

/**
 * Lists the direct children of a SAF folder with one provider query, off the JS thread (see
 * modules/saf-lister). Rejects when access was lost or the native lister is missing.
 */
export async function listSafChildren(uri: string): Promise<FolderTreeChild[]> {
  const safLister = requireOptionalNativeModule<SafListerModule>(SAF_LISTER_MODULE_NAME);
  if (!safLister) {
    throw new Error(`${SAF_LISTER_MODULE_NAME} is not in this build`);
  }

  return safLister.listChildren(uri);
}

/** True when the persisted SAF root still exists and is readable (SD card present, grant kept). */
export function isSafRootReadable(uri: string): boolean {
  try {
    return new Directory(uri).exists;
  } catch {
    return false;
  }
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
