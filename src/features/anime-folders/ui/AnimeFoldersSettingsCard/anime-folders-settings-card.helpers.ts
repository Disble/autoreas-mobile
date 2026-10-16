import { formatLastSyncRecency } from '../../../sync/sync-visible-status.helpers';
import { ANIME_FOLDERS_SETTINGS_COPY } from './anime-folders-settings-card.constants';
import type {
  AnimeFoldersSettingsCardInput,
  AnimeFoldersSettingsCardView,
} from './anime-folders-settings-card.types';

/** Formats a count with its singular or plural noun. */
function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "Encontradas" value: unreadable, still searching with no summary yet, or the count. */
function getFoundLabel(input: AnimeFoldersSettingsCardInput): string {
  if (input.status === 'lost') {
    return ANIME_FOLDERS_SETTINGS_COPY.unreadable;
  }

  if (!input.summary) {
    return ANIME_FOLDERS_SETTINGS_COPY.searching;
  }

  return pluralize(input.summary.animesWithFolder, 'anime con carpeta', 'animes con carpeta');
}

/** "Revisado" value: searching while an index runs, else how long ago the last one finished. */
function getReviewedLabel(input: AnimeFoldersSettingsCardInput): string {
  if (input.status === 'indexing') {
    return ANIME_FOLDERS_SETTINGS_COPY.searching;
  }

  return formatLastSyncRecency(input.indexedAt, input.now) ?? '—';
}

/** Builds the copy of the "Carpetas de anime" Settings card (canvas 05). */
export function buildAnimeFoldersSettingsCardView(
  input: AnimeFoldersSettingsCardInput,
): AnimeFoldersSettingsCardView {
  const { status, rootLabel, summary } = input;
  const hasSummary = summary !== null && status !== 'lost';

  return {
    hasRoot: rootLabel !== null,
    rootLabel: rootLabel ?? ANIME_FOLDERS_SETTINGS_COPY.noRoot,
    foundLabel: getFoundLabel(input),
    reviewedLabel: getReviewedLabel(input),
    unmatchedLabel: hasSummary
      ? pluralize(summary.unmatchedFolders.length, 'carpeta sin anime', 'carpetas sin anime')
      : null,
  };
}

/** Confirmation shown after a folder is chosen and indexed. */
export function formatAnimeFoldersConfirmation(animesWithFolder: number): string {
  return animesWithFolder === 1
    ? 'Listo: 1 anime ya abre su carpeta desde la tarjeta.'
    : `Listo: ${animesWithFolder} animes ya abren su carpeta desde la tarjeta.`;
}
