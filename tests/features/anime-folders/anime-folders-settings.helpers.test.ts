import { buildFolderIndex, resolveAnimeFolders } from '../../../src/features/anime-folders/anime-folders.helpers';
import { buildAnimeFoldersDetailView } from '../../../src/features/anime-folders/ui/AnimeFoldersDetailScreen/anime-folders-detail-screen.helpers';
import {
  buildAnimeFoldersSettingsCardView,
  formatAnimeFoldersConfirmation,
} from '../../../src/features/anime-folders/ui/AnimeFoldersSettingsCard/anime-folders-settings-card.helpers';
import type { AnimeFolderSource } from '../../../src/features/anime-folders/anime-folders.types';

/** Clock the recency label is measured against. */
const NOW = new Date('2026-10-15T12:00:00Z');

/** Summary of the device baseline: Bleach and Wano matched, a shared Date a Live, Haruhi alone. */
function deviceSummary() {
  const index = buildFolderIndex(
    ['Bleach', 'One Pace - Whole Cake Island/One Pace - Wano', 'Date a Live', 'Haruhi BD'].map(
      (relativePath) => ({ relativePath, documentId: `0123-4567:Videos/Anime/${relativePath}` }),
    ),
  );
  const animes: AnimeFolderSource[] = [
    { id: 'a1', carpeta: 'D:/Anime/Bleach', folderRelative: 'Anime/Bleach' },
    { id: 'a2', carpeta: 'D:/One Pace - Reverie/One Pace - Wano', folderRelative: null },
    { id: 'a3', carpeta: 'D:/Anime/Date a Live', folderRelative: null },
    { id: 'a4', carpeta: 'E:/Old/Date a Live', folderRelative: null },
  ];

  return resolveAnimeFolders(index, animes).summary;
}

describe('buildAnimeFoldersSettingsCardView', () => {
  it('shows the chosen root, how many animes open their folder, and when it was checked', () => {
    const view = buildAnimeFoldersSettingsCardView({
      status: 'ready',
      rootLabel: 'SD card › Videos › Anime',
      summary: deviceSummary(),
      indexedAt: NOW.getTime() - 10_000,
      now: NOW,
    });

    expect(view).toEqual({
      hasRoot: true,
      rootLabel: 'SD card › Videos › Anime',
      foundLabel: '2 animes con carpeta',
      reviewedLabel: 'hace un momento',
      unmatchedLabel: '1 carpeta sin anime',
    });
  });

  it('says singular and plural the way the canvas does', () => {
    const summary = { ...deviceSummary(), animesWithFolder: 1, unmatchedFolders: [] };

    const view = buildAnimeFoldersSettingsCardView({
      status: 'ready',
      rootLabel: 'SD card › Videos › Anime',
      summary,
      indexedAt: NOW.getTime() - 5 * 60_000,
      now: NOW,
    });

    expect(view.foundLabel).toBe('1 anime con carpeta');
    expect(view.unmatchedLabel).toBe('0 carpetas sin anime');
    expect(view.reviewedLabel).toBe('hace 5 min');
  });

  it('offers only choosing a folder before one is chosen', () => {
    const view = buildAnimeFoldersSettingsCardView({
      status: 'idle',
      rootLabel: null,
      summary: null,
      indexedAt: null,
      now: NOW,
    });

    expect(view).toMatchObject({ hasRoot: false, rootLabel: 'Sin elegir', unmatchedLabel: null });
  });

  it('says it is searching while the first index runs, and keeps the last summary on a refresh', () => {
    const first = buildAnimeFoldersSettingsCardView({
      status: 'indexing',
      rootLabel: 'SD card › Videos › Anime',
      summary: null,
      indexedAt: null,
      now: NOW,
    });
    const refresh = buildAnimeFoldersSettingsCardView({
      status: 'indexing',
      rootLabel: 'SD card › Videos › Anime',
      summary: deviceSummary(),
      indexedAt: NOW.getTime() - 10_000,
      now: NOW,
    });

    expect(first).toMatchObject({
      foundLabel: 'Buscando carpetas…',
      reviewedLabel: 'Buscando carpetas…',
      unmatchedLabel: null,
    });
    expect(refresh).toMatchObject({ foundLabel: '2 animes con carpeta', reviewedLabel: 'Buscando carpetas…' });
  });

  it('says the folder cannot be read once access is lost, even with a summary left over', () => {
    const view = buildAnimeFoldersSettingsCardView({
      status: 'lost',
      rootLabel: 'SD card › Videos › Anime',
      summary: deviceSummary(),
      indexedAt: null,
      now: NOW,
    });

    expect(view).toMatchObject({ foundLabel: 'No se puede leer la carpeta', unmatchedLabel: null });
  });
});

describe('formatAnimeFoldersConfirmation', () => {
  it('confirms how many animes now open their folder', () => {
    expect(formatAnimeFoldersConfirmation(22)).toBe(
      'Listo: 22 animes ya abren su carpeta desde la tarjeta.',
    );
    expect(formatAnimeFoldersConfirmation(1)).toBe(
      'Listo: 1 anime ya abre su carpeta desde la tarjeta.',
    );
  });
});

describe('buildAnimeFoldersDetailView', () => {
  it('builds the totals and the three lists of the detail screen', () => {
    const view = buildAnimeFoldersDetailView(deviceSummary());

    expect(view.totals).toEqual({ folders: 4, withAnime: 2, withoutAnime: 1 });
    expect(view.unmatchedTitle).toBe('SIN ANIME · 1');
    expect(view.unmatchedFolders).toEqual(['Haruhi BD']);
    expect(view.sharedTitle).toBe('CON MÁS DE UN ANIME · 1');
    expect(view.sharedFolders).toEqual(['Date a Live']);
    expect(view.matchedTitle).toBe('CON ANIME · 2');
    expect(view.matchedFolders).toEqual([
      { name: 'Bleach', methodLabel: 'ruta de la PC' },
      { name: 'One Pace - Wano', methodLabel: 'nombre exacto' },
    ]);
  });
});
