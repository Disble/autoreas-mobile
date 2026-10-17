-- Convergent sync (ADR 009 L28): season ratings are `season_rating` rows of `operation_log`, so
-- the separate `season_rating_queue` retires. Dropping the table drops its index with it.
--
-- Hand-written, following 0011-0018: this repository's `meta/` snapshot chain is stale.
--
-- BOTH routes are required. This file is the route for a freshly installed device, whose queue
-- is empty because 0009 created it moments earlier. An already provisioned device never runs this
-- file (`reconcileMigrationLedger` pins the gate): it reaches the same end state through the repair
-- step `moveSeasonRatingQueueIntoOperationLog`, which first moves every queued rating into
-- `operation_log` and drops the table in the same exclusive transaction.

DROP TABLE IF EXISTS `season_rating_queue`;
