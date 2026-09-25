-- Diagnostics disposition-counter columns.
--
-- The drainer's result has always carried `undeliverable` (destroyed by judgement) and
-- `unclassified` (parked, unknown to this build) beside `discarded`, and nothing persisted or
-- surfaced either of them. A policy that calls `undeliverable` a DESTRUCTION counter while no
-- device can observe it is a live gap, not a recorded one, so both are stored beside the existing
-- `last_diagnostics_discarded_count` through the same patch helper, write and call site. The three
-- stay distinct and none is derived from another.
--
-- Hand-written, following 0011 and 0012: this repository's `meta/` snapshot chain is stale (no
-- `0009`, `0011` or `0012` snapshot exists), so the generator re-emits ALTERs for columns that
-- already exist on installed databases and would abort the migration with a duplicate-column
-- error. This file carries exactly the two columns this change introduces and nothing else.
--
-- BOTH routes are required and neither is redundant. This file is a freshly-installed device's
-- route. An ALREADY provisioned device never runs it, because `reconcileMigrationLedger` pins the
-- migrator's gate; its only route to these columns is the idempotent repair twin in
-- `SYNC_RUNTIME_STATUS_COLUMN_DEFINITIONS` (`ensureMissingColumns`). `tests/infrastructure/db/
-- migration-repair-parity.test.ts` pins that pair, so a column can never ship with only one.
--
-- Both columns are nullable with no default: NULL means "never measured", never a plausible zero
-- (design.md Decision 7). A destruction counter that reads 0 because it was never written is the
-- exact false answer this policy exists to prevent.

ALTER TABLE `sync_runtime_status` ADD `last_diagnostics_undeliverable_count` integer;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_diagnostics_unclassified_count` integer;
