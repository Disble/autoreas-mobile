import {
  buildFolderIndex,
  formatRootLabel,
  getOpenablePageUrl,
  getSafDocumentId,
  resolveAnimeFolders,
  toDeviceStoragePath,
  walkFolderTree,
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

/** In-memory SAF tree keyed by folder uri; `null` relative path is the root. */
function makeLister(tree: Record<string, readonly (string | { file: string })[]>) {
  const listed: string[] = [];
  const lister = async (uri: string): Promise<FolderTreeChild[]> => {
    listed.push(uri);
    const relative = uri === ROOT_URI ? '' : decodeURIComponent(uri.split('/document/')[1] ?? '').replace('0123-4567:Videos/Anime/', '');
    return (tree[relative] ?? []).map((child) =>
      typeof child === 'string'
        ? { uri: childUri(relative ? `${relative}/${child}` : child), isDirectory: true }
        : { uri: childUri(relative ? `${relative}/${child.file}` : child.file), isDirectory: false },
    );
  };

  return { lister, listed };
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

/** Active anime source with only a PC folder. */
function anime(id: string, carpeta: string | null, folderRelative: string | null = null): AnimeFolderSource {
  return { id, carpeta, folderRelative, activo: 1 };
}

/** Inactive (soft-deleted) anime source: still a row on mobile, but no card in the list. */
function inactiveAnime(id: string, carpeta: string): AnimeFolderSource {
  return { id, carpeta, folderRelative: null, activo: 0 };
}

describe('SAF uri helpers', () => {
  it('reads the document id of a tree uri and of a child document uri', () => {
    expect(getSafDocumentId(ROOT_URI)).toBe('0123-4567:Videos/Anime');
    expect(getSafDocumentId(childUri('Bleach'))).toBe('0123-4567:Videos/Anime/Bleach');
    expect(getSafDocumentId('file:///data/user/0')).toBeNull();
  });

  it('maps an SD card or internal storage document id to the path My Files opens', () => {
    expect(toDeviceStoragePath('0123-4567:Videos/Anime/Bleach')).toBe('/storage/0123-4567/Videos/Anime/Bleach');
    expect(toDeviceStoragePath('primary:Movies')).toBe('/storage/emulated/0/Movies');
    expect(toDeviceStoragePath('not-a-document-id')).toBeNull();
  });

  it('labels the root as the breadcrumb shown in Settings', () => {
    expect(formatRootLabel(ROOT_URI)).toBe('SD card › Videos › Anime');
    expect(formatRootLabel('content://com.android.externalstorage.documents/tree/primary%3AMovies')).toBe(
      'Almacenamiento interno › Movies',
    );
  });
});

describe('walkFolderTree', () => {
  it('finds folders up to 3 levels, skipping hidden folders and files', async () => {
    const { lister } = makeLister({
      '': ['Bleach', '.stfolder', { file: 'app.apk' }, 'One Pace - Whole Cake Island'],
      'One Pace - Whole Cake Island': ['One Pace - Wano'],
      'One Pace - Whole Cake Island/One Pace - Wano': ['Level 3'],
      'One Pace - Whole Cake Island/One Pace - Wano/Level 3': ['Level 4'],
    });

    const entries = await walkFolderTree(ROOT_URI, lister);

    expect(entries.map((entry) => entry.relativePath)).toEqual([
      'Bleach',
      'One Pace - Whole Cake Island',
      'One Pace - Whole Cake Island/One Pace - Wano',
      'One Pace - Whole Cake Island/One Pace - Wano/Level 3',
    ]);
  });

  it('lists each folder once, waiting for each listing before going deeper', async () => {
    const { lister, listed } = makeLister({ '': ['A', 'B'], A: ['A1'] });

    const entries = await walkFolderTree(ROOT_URI, lister);

    expect(listed).toEqual([ROOT_URI, childUri('A'), childUri('B'), childUri('A/A1')]);
    expect(entries.map((entry) => entry.relativePath)).toEqual(['A', 'B', 'A/A1']);
  });

  it('fails when the root can no longer be listed', async () => {
    const lister = () => Promise.reject(new Error('permission revoked'));

    await expect(walkFolderTree(ROOT_URI, lister)).rejects.toThrow('permission revoked');
  });
});

describe('resolveAnimeFolders', () => {
  it('resolves by the bridge path first, even when the device root sits at another level', () => {
    const index = indexOf('Bleach', 'Old/Bleach');

    const { byAnimeId } = resolveAnimeFolders(index, [
      anime('a1', 'D:\\Videos\\Anime\\Old\\Bleach', 'Anime/Old/Bleach'),
    ]);

    expect(byAnimeId.get('a1')).toMatchObject({
      method: 'path',
      folder: { relativePath: 'Old/Bleach', devicePath: '/storage/0123-4567/Videos/Anime/Old/Bleach' },
    });
  });

  it('falls back to the exact folder name, ignoring case, when the bridge path does not match', () => {
    const index = indexOf('One Pace - Whole Cake Island/One Pace - Wano');

    const { byAnimeId } = resolveAnimeFolders(index, [
      anime('a1', 'D:\\One Pace - Reverie\\one pace - wano', 'One Pace - Reverie/one pace - wano'),
    ]);

    expect(byAnimeId.get('a1')).toMatchObject({
      method: 'exact',
      folder: { relativePath: 'One Pace - Whole Cake Island/One Pace - Wano' },
    });
  });

  it('falls back to the normalized name when punctuation or accents differ', () => {
    const index = indexOf('Nijuuseiki Denki Mokuroku Eureka Evrika');

    const { byAnimeId } = resolveAnimeFolders(index, [
      anime('a1', 'D:/Anime/Nijuuseiki Denki Mokuroku: Eureka・Évrika'),
    ]);

    expect(byAnimeId.get('a1')).toMatchObject({ method: 'normalized' });
  });

  it('never matches a non-latin name by what is left after normalization', () => {
    const index = indexOf('大阪 1');

    const { byAnimeId } = resolveAnimeFolders(index, [anime('a1', 'D:/Anime/東京 1')]);

    expect(byAnimeId.has('a1')).toBe(false);
  });

  it('resolves nothing when a name matches more than one folder', () => {
    const index = indexOf('2024/Bleach', '2025/Bleach');

    const { byAnimeId } = resolveAnimeFolders(index, [anime('a1', 'D:/Anime/Bleach')]);

    expect(byAnimeId.has('a1')).toBe(false);
  });

  it('resolves nothing without a folder, or when nothing matches', () => {
    const index = indexOf('Bleach');

    const { byAnimeId } = resolveAnimeFolders(index, [anime('a1', null), anime('a2', 'D:/Anime/Naruto')]);

    expect(byAnimeId.size).toBe(0);
  });

  it('gives no anime the folder when two animes resolve to the same one', () => {
    const index = indexOf('Bleach', 'Date a Live');

    const { byAnimeId, summary } = resolveAnimeFolders(index, [
      anime('a1', 'D:/Anime/Bleach'),
      anime('a2', 'E:/Old/Bleach'),
      anime('a3', 'D:/Anime/Date a Live'),
    ]);

    expect([...byAnimeId.keys()]).toEqual(['a3']);
    expect(summary.sharedFolders.map((folder) => folder.relativePath)).toEqual(['Bleach']);
  });

  it('summarizes the device baseline: subfolders of a matched folder are content, not findings', () => {
    const index = indexOf(
      'Bleach',
      'Super no Ura de Yani Suu Futari',
      'Super no Ura de Yani Suu Futari/Mini Episodes',
      'One Pace - Whole Cake Island',
      'One Pace - Whole Cake Island/One Pace - Wano',
      'Suzumiya Haruhi no Yuuutsu BD Castellano',
    );

    const { summary } = resolveAnimeFolders(index, [
      anime('a1', 'D:/Anime/Bleach'),
      anime('a2', 'D:/Anime/Super no Ura de Yani Suu Futari'),
      anime('a3', 'D:/Anime/One Pace - Whole Cake Island'),
      anime('a4', 'D:/Anime/One Pace - Reverie/One Pace - Wano'),
    ]);

    expect(summary.folderCount).toBe(6);
    expect(summary.animesWithFolder).toBe(4);
    expect(summary.matchedFolders.map((match) => [match.folder.name, match.method])).toEqual([
      ['Bleach', 'exact'],
      ['Super no Ura de Yani Suu Futari', 'exact'],
      ['One Pace - Whole Cake Island', 'exact'],
      ['One Pace - Wano', 'exact'],
    ]);
    expect(summary.unmatchedFolders.map((folder) => folder.relativePath)).toEqual([
      'Suzumiya Haruhi no Yuuutsu BD Castellano',
    ]);
    expect(summary.sharedFolders).toEqual([]);
  });

  it('lists only the outermost folder without anime, not its subfolders', () => {
    const index = indexOf('Haruhi BD', 'Haruhi BD/Disc 1', 'Bleach');

    const { summary } = resolveAnimeFolders(index, [anime('a1', 'D:/Anime/Bleach')]);

    expect(summary.unmatchedFolders.map((folder) => folder.relativePath)).toEqual(['Haruhi BD']);
  });
});

describe('getOpenablePageUrl', () => {
  it('keeps an http(s) url with a host, trimmed', () => {
    expect(getOpenablePageUrl(' https://jkanime.net/bleach/ ')).toBe('https://jkanime.net/bleach/');
    expect(getOpenablePageUrl('http://example.com')).toBe('http://example.com');
  });

  it('has no page for anything else', () => {
    expect(getOpenablePageUrl('descargado')).toBeNull();
    expect(getOpenablePageUrl('https://')).toBeNull();
    expect(getOpenablePageUrl('ftp://example.com')).toBeNull();
    expect(getOpenablePageUrl('')).toBeNull();
    expect(getOpenablePageUrl(null)).toBeNull();
  });

  it('does not let an inactive anime take the folder of an active one', () => {
    const index = indexOf('Bleach');

    const { byAnimeId, summary } = resolveAnimeFolders(index, [
      inactiveAnime('old', 'E:/Old/Bleach'),
      anime('a1', 'D:/Anime/Bleach'),
    ]);

    expect(byAnimeId.get('a1')?.folder.relativePath).toBe('Bleach');
    expect(summary.sharedFolders).toEqual([]);
    expect(summary.matchedFolders.map((match) => match.folder.name)).toEqual(['Bleach']);
  });

  it('counts a folder only an inactive anime uses as having anime, without a button', () => {
    const index = indexOf('Bleach', 'Haruhi BD');

    const { byAnimeId, summary } = resolveAnimeFolders(index, [inactiveAnime('old', 'E:/Old/Bleach')]);

    expect(byAnimeId.size).toBe(0);
    expect(summary.matchedFolders.map((match) => match.folder.name)).toEqual(['Bleach']);
    expect(summary.unmatchedFolders.map((folder) => folder.name)).toEqual(['Haruhi BD']);
    expect(summary.animesWithFolder).toBe(0);
  });

  it('still shares a folder two active animes resolve to, whatever inactive ones do', () => {
    const index = indexOf('Bleach');

    const { byAnimeId, summary } = resolveAnimeFolders(index, [
      anime('a1', 'D:/Anime/Bleach'),
      anime('a2', 'E:/Old/Bleach'),
      inactiveAnime('old', 'F:/Bleach'),
    ]);

    expect(byAnimeId.size).toBe(0);
    expect(summary.sharedFolders.map((folder) => folder.name)).toEqual(['Bleach']);
  });
});
