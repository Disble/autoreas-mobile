-- Per-episode durations column (`MobileAnime.episodes` on the wire).
--
-- Stores the bridge's `[{ episode, minutes, long }]` array as JSON text, the same way `dias` and
-- `generos` are stored. Nullable with no default: NULL means "no durations known", which is also
-- what the bridge means by an absent field, so a row synced before this column existed reads back
-- exactly that until the next foreground resync fills it.
--
-- Hand-written, following 0011-0015: this repository's `meta/` snapshot chain is stale, so the
-- generator would re-emit ALTERs for columns that already exist on installed databases.
--
-- BOTH routes are required. This file is a freshly-installed device's route; an already
-- provisioned device reaches the column only through its idempotent repair twin in
-- `ANIMES_COLUMN_DEFINITIONS`. `tests/infrastructure/db/migration-repair-parity.test.ts` pins the pair.

ALTER TABLE `animes` ADD `episodes` text;
