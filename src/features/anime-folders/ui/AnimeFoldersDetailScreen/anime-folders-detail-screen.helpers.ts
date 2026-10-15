import type { FolderIndexSummary } from '../../anime-folders.types';
import { FOLDER_MATCH_METHOD_LABEL } from './anime-folders-detail-screen.constants';
import type { AnimeFoldersDetailView } from './anime-folders-detail-screen.types';

/** Builds the totals and the "SIN ANIME", "CON MÁS DE UN ANIME" and "CON ANIME" lists. */
export function buildAnimeFoldersDetailView(summary: FolderIndexSummary): AnimeFoldersDetailView {
  const { folderCount, matchedFolders, sharedFolders, unmatchedFolders } = summary;

  return {
    totals: {
      folders: folderCount,
      withAnime: matchedFolders.length,
      withoutAnime: unmatchedFolders.length,
    },
    unmatchedTitle: `SIN ANIME · ${unmatchedFolders.length}`,
    unmatchedFolders: unmatchedFolders.map((folder) => folder.name),
    sharedTitle: `CON MÁS DE UN ANIME · ${sharedFolders.length}`,
    sharedFolders: sharedFolders.map((folder) => folder.name),
    matchedTitle: `CON ANIME · ${matchedFolders.length}`,
    matchedFolders: matchedFolders.map((match) => ({
      name: match.folder.name,
      methodLabel: FOLDER_MATCH_METHOD_LABEL[match.method],
    })),
  };
}
