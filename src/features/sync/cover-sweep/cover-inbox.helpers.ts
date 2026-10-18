import { buildCoverFileName } from '../../../infrastructure/cover-files/cover-files.helpers';
import type { CoverInboxEntry, CoverManifest } from '../../../infrastructure/cover-files';
import { COVER_REVALIDATE_MS } from './cover-sweep.constants';
import type { CoverInboxAdoption, CoverInboxAdoptionPlan } from './cover-sweep.types';

/**
 * Decides what to do with each cover the native background sync left in the inbox. A cover is
 * adopted when the manifest has no file for its anime yet -- no entry, or one whose last answer
 * left no file -- and becomes a fresh `image` entry, as if the sweep had fetched it at `fetchedAt`:
 * named by its etag (or `fetchedAt` without one) and due again after `COVER_REVALIDATE_MS`. When the
 * app already has a file for that anime, its own sweep owns revalidating it, so the native copy is
 * dropped.
 */
export function planCoverInboxAdoption(
  manifest: CoverManifest,
  inboxEntries: readonly CoverInboxEntry[],
): CoverInboxAdoptionPlan {
  const adopt: CoverInboxAdoption[] = [];
  const discard: CoverInboxEntry[] = [];

  for (const inboxEntry of inboxEntries) {
    if (manifest.entries[inboxEntry.animeId]?.fileName) {
      discard.push(inboxEntry);
      continue;
    }

    const fileName = buildCoverFileName(inboxEntry.animeId, inboxEntry.etag, String(inboxEntry.fetchedAt));

    adopt.push({
      inboxEntry,
      fileName,
      manifestEntry: {
        status: 'image',
        fileName,
        etag: inboxEntry.etag,
        checkedAt: inboxEntry.fetchedAt,
        nextAttemptAt: inboxEntry.fetchedAt + COVER_REVALIDATE_MS,
        failureCount: 0,
        sourceKey: inboxEntry.sourceKey,
      },
    });
  }

  return { adopt, discard };
}
