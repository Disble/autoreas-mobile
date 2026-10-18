-- Season on the anime sync path (`MobileAnime.season` and `ReconcileResponse.season_mode` on the
-- wire). Season state now travels with the anime instead of on its own pull.
--
-- `animes.season` stores the bridge's `{ seasonId, grade }` object as JSON text, the same way
-- `episodes` is stored. Nullable with no default: NULL means "not a candidate of the open season",
-- which is also what the bridge means by an absent field.
--
-- `bridge_config.season_mode` holds the last reconcile's `season_mode`: whether the bridge has a
-- season open. It defaults to 0 ("none known yet") until the first reconcile answers, and leaves
-- with the pairing row like the changelog cursor does.
--
-- Hand-written, following 0011-0020: this repository's `meta/` snapshot chain is stale.
--
-- BOTH routes are required. This file is a freshly-installed device's route; an already
-- provisioned device reaches the columns only through their idempotent repair twins in
-- `ANIMES_COLUMN_DEFINITIONS` and `BRIDGE_CONFIG_COLUMN_DEFINITIONS`.
-- `tests/infrastructure/db/migration-repair-parity.test.ts` pins the pairs.

ALTER TABLE `animes` ADD `season` text;
--> statement-breakpoint
ALTER TABLE `bridge_config` ADD `season_mode` integer DEFAULT 0 NOT NULL;
