import type { AnimeFoldersIndexStatus } from '../../anime-folders.types';

/** Which banner the list shows: the feature hint, the lost-access warning, or none. */
export type AnimeFolderBannerKind = 'hint' | 'lost' | null;

/** Inputs that decide the banner kind. */
export interface AnimeFolderBannerKindInput {
  readonly isLoaded: boolean;
  readonly status: AnimeFoldersIndexStatus;
  readonly hasRoot: boolean;
  readonly hintDismissedAt: number | null;
}

/** Title and description of one banner. */
export interface AnimeFolderBannerCopy {
  readonly title: string;
  readonly description: string;
}
