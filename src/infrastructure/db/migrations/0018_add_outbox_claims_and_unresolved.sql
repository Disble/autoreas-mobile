-- Convergent sync (ADR 009): per-key claims (R-13) and the unresolved reason (R-16b).
--
-- `claim_owner` names the runtime that holds the key ('js' or 'native'), and `claimed_at` is the
-- epoch ms the claim was taken. A claim is live for 60 s after `claimed_at`. Both are nullable with
-- no default: NULL means "unclaimed", which is also the truth for every row queued before this
-- migration.
--
-- `unresolved_reason` records why an `operation_log` row was given up through a path that has no
-- status of its own (the R-3 fetch-first outcomes `bridge_404` and `token_missing`). It is nullable:
-- NULL on every row that is not unresolved. `season_rating_queue` already has `last_failure_kind`
-- for this purpose.
--
-- Hand-written, following 0011-0017: this repository's `meta/` snapshot chain is stale, so the
-- generator would re-emit ALTERs for columns that already exist on installed databases.
--
-- BOTH routes are required. This file is the route for a freshly installed device. An already
-- provisioned device reaches the columns only through their idempotent repair twins in
-- `OPERATION_LOG_COLUMN_DEFINITIONS` and `SEASON_RATING_QUEUE_COLUMN_DEFINITIONS`.
-- `tests/infrastructure/db/migration-repair-parity.test.ts` pins each pair.

ALTER TABLE `operation_log` ADD `claim_owner` text;
--> statement-breakpoint
ALTER TABLE `operation_log` ADD `claimed_at` integer;
--> statement-breakpoint
ALTER TABLE `operation_log` ADD `unresolved_reason` text;
--> statement-breakpoint
ALTER TABLE `season_rating_queue` ADD `claim_owner` text;
--> statement-breakpoint
ALTER TABLE `season_rating_queue` ADD `claimed_at` integer;
