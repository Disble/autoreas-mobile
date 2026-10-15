import type { AnimeFolderBannerKind, AnimeFolderBannerKindInput } from './anime-folder-banner.types';

/**
 * Lost access wins over the hint. The hint shows only once preferences are read, while no root is
 * set and it was never dismissed, so it never flashes on launch for a user who already chose.
 */
export function getAnimeFolderBannerKind(input: AnimeFolderBannerKindInput): AnimeFolderBannerKind {
  if (input.status === 'lost') {
    return 'lost';
  }

  if (input.isLoaded && !input.hasRoot && input.hintDismissedAt === null) {
    return 'hint';
  }

  return null;
}
