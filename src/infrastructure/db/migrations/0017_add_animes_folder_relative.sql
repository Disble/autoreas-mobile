-- Anime folder path below the bridge's library root (`MobileAnime.folderRelative` on the wire).
--
-- A `/`-separated relative path the device joins onto the anime root the user picked, so a folder
-- resolves by path before falling back to name matching. Nullable with no default: NULL means "the
-- bridge sent no path", which is also what an absent field means, so a row synced before this
-- column existed reads back exactly that until the next foreground resync fills it.
--
-- Hand-written, following 0011-0016: this repository's `meta/` snapshot chain is stale, so the
-- generator would re-emit ALTERs for columns that already exist on installed databases.
--
-- BOTH routes are required. This file is a freshly-installed device's route; an already
-- provisioned device reaches the column only through its idempotent repair twin in
-- `ANIMES_COLUMN_DEFINITIONS`. `tests/infrastructure/db/migration-repair-parity.test.ts` pins the pair.

ALTER TABLE `animes` ADD `folder_relative` text;
