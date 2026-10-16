import {
  buildFolderIndex,
  buildFolderUri,
  findFolderProbes,
  hasFolderProbeHit,
} from '../../../src/features/anime-folders/anime-folders.helpers';
import type {
  AnimeFolderSource,
  FolderTreeChild,
} from '../../../src/features/anime-folders/anime-folders.types';

/** Tree uri the picker returns for the SD card anime root. */
const ROOT_URI = 'content://com.android.externalstorage.documents/tree/0123-4567%3AVideos%2FAnime';

/** Builds the SAF child uri of a folder below the SD card anime root. */
function childUri(relativePath: string): string {
  return `${ROOT_URI}/document/${encodeURIComponent(`0123-4567:Videos/Anime/${relativePath}`)}`;
}

/** Index built from plain relative folder paths below the SD card anime root. */
function indexOf(...relativePaths: string[]) {
  return buildFolderIndex(
    relativePaths.map((relativePath) => ({
      relativePath,
      documentId: `0123-4567:Videos/Anime/${relativePath}`,
    })),
  );
}

/** Anime source with a bridge path; active unless `activo` says otherwise. */
function anime(id: string, folderRelative: string | null, activo = 1): AnimeFolderSource {
  return { id, carpeta: folderRelative ? `D:\\Anime\\${folderRelative}` : null, folderRelative, activo };
}

/** A folder child of a parent listing. */
function folder(relativePath: string): FolderTreeChild {
  return { uri: childUri(relativePath), isDirectory: true };
}

describe('findFolderProbes', () => {
  it('looks in the root for the folder of an active anime the index does not have yet', () => {
    const probes = findFolderProbes(indexOf('Bleach'), [
      anime('ranma', 'Ranma 1 2 (2024) 3rd Season'),
      anime('ao-ashi', 'Ao Ashi Season 2nd'),
    ]);

    expect(probes).toEqual([
      { parentRelativePath: '', expectedKeys: ['ranma 1 2 (2024) 3rd season', 'ao ashi season 2nd'] },
    ]);
  });

  it('looks inside the indexed parent of a nested bridge path', () => {
    const probes = findFolderProbes(indexOf('One Pace'), [anime('wano', 'One Pace/Wano')]);

    expect(probes).toEqual([{ parentRelativePath: 'One Pace', expectedKeys: ['wano'] }]);
  });

  it('looks for the first missing folder of the path when its parent is missing too', () => {
    const probes = findFolderProbes(indexOf('Bleach'), [anime('wano', 'One Pace/Wano')]);

    expect(probes).toEqual([{ parentRelativePath: '', expectedKeys: ['one pace'] }]);
  });

  it('skips animes whose folder is indexed, inactive animes, and animes without a bridge path', () => {
    const probes = findFolderProbes(indexOf('Bleach', 'Naruto', 'Naruto/Naruto'), [
      anime('bleach', 'Bleach'),
      anime('shared', 'Naruto'),
      anime('inactive', 'Date A Live V', 0),
      anime('no-path', null),
    ]);

    expect(probes).toEqual([]);
  });

  it('skips an anime whose parent matches more than one indexed folder', () => {
    const probes = findFolderProbes(indexOf('A/Extras', 'B/Extras'), [anime('x', 'Extras/Movie')]);

    expect(probes).toEqual([]);
  });
});

describe('buildFolderUri', () => {
  it('returns the root uri for the root and a child document uri below it', () => {
    expect(buildFolderUri(ROOT_URI, '')).toBe(ROOT_URI);
    expect(buildFolderUri(ROOT_URI, 'One Pace')).toBe(childUri('One Pace'));
  });

  it('builds a child of a volume root without a doubled separator', () => {
    const volumeRoot = 'content://com.android.externalstorage.documents/tree/0123-4567%3A';

    expect(buildFolderUri(volumeRoot, 'Anime')).toBe(
      `${volumeRoot}/document/${encodeURIComponent('0123-4567:Anime')}`,
    );
  });
});

describe('hasFolderProbeHit', () => {
  const probe = { parentRelativePath: '', expectedKeys: ['ranma 1 2 (2024) 3rd season'] };

  it('hits when the listing holds an expected folder, whatever its case', () => {
    expect(hasFolderProbeHit(probe, [folder('Bleach'), folder('Ranma 1 2 (2024) 3rd SEASON')])).toBe(true);
  });

  it('misses when the expected name is only a file or not there at all', () => {
    const file = { uri: childUri('Ranma 1 2 (2024) 3rd Season'), isDirectory: false };

    expect(hasFolderProbeHit(probe, [file, folder('Bleach')])).toBe(false);
  });
});
