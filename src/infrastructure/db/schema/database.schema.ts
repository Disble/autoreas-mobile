import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type {
  SyncCycleStage,
  SyncRuntimeRegistrationStatus,
  SyncRuntimeTriggerSource,
} from '../../../features/sync/sync-runtime-status.types';
import type { SyncExecutionMode } from '../../../features/sync/sync-execution-mode.types';

/** Provides the shared animes value. */

export const animes = sqliteTable("animes", {
  _id: text("_id").primaryKey(),
  nombre: text("nombre").notNull(),
  estado: integer("estado").notNull().default(0),
  nrocapvisto: real("nrocapvisto").notNull().default(0),
  totalcap: integer("totalcap"),
  dias: text("dias"),
  generos: text("generos"),
  tipo: integer("tipo"),
  activo: integer("activo").notNull().default(1),
  primeravez: integer("primeravez").notNull().default(1),
  fechaUltCapVisto: integer("fechaUltCapVisto"),
  fechaEstreno: integer("fechaEstreno"),
  fechaCreacion: integer("fechaCreacion"),
  fechaEliminacion: integer("fechaEliminacion"),
  portada: text("portada"),
  pagina: text("pagina"),
  carpeta: text("carpeta"),
  estudios: text("estudios"),
  origen: text("origen"),
  duracion: integer("duracion"),
  lastAppliedChangeMs: integer("last_applied_change_ms"),
  // Bridge-authored optimistic-concurrency token (`modified_at` on the wire), nullable with no
  // default so a pre-migration row reads back NULL ("no token known"), never a fabricated 0 --
  // 0 is itself a real, legitimate token. Transport/persistence only: it must never reach the
  // domain `Anime`/`AnimeSchema` shape or any UI-facing list item (see `anime.helpers.ts`).
  // Distinct from `lastAppliedChangeMs`, which guards remote->local apply order and is derived
  // from `change.timestamp`; this column is never derived from that guard or from it.
  bridgeModifiedAt: integer("bridge_modified_at"),
});

/** Provides the shared operation log value. */

export const operationLog = sqliteTable(
  "operation_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    animeId: text("anime_id").notNull(),
    operation: text("operation").notNull(),
    payload: text("payload").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: integer("created_at").notNull(),
    // Per-row, client-authored count of NON-PROGRESSING `conflict` responses this operation has
    // received (design.md Decision 6). Lives on `operation_log`, not `animes`, because its
    // lifetime is the OPERATION: two queued operations for the same anime must not share one
    // budget, or the second could be born already exhausted by the first's failures. Resets to 0
    // whenever a conflict response's token advances past the stored one (progress was made);
    // increments only when it repeats the same token. NOT NULL with a default of 0 -- unlike the
    // OCC token columns, a freshly queued row has definitely made zero attempts, never "unknown".
    conflictAttemptCount: integer("conflict_attempt_count").notNull().default(0),
  },
  (table) => [
    index('operation_log_status_created_at_idx').on(
      table.status,
      table.createdAt,
      table.id,
    ),
  ],
);

/** Provides the shared season rating queue value. */

export const seasonRatingQueue = sqliteTable(
  'season_rating_queue',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: text('season_id').notNull(),
    animeId: text('anime_id').notNull(),
    nota: integer('nota').notNull(),
    ratedAt: integer('rated_at').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastAttemptAt: integer('last_attempt_at'),
    lastFailureKind: text('last_failure_kind'),
  },
  (table) => [
    index('season_rating_queue_status_created_at_idx').on(
      table.status,
      table.createdAt,
      table.id,
    ),
  ],
);

/** Provides the durable bridge-owned active season snapshot for offline startup. */
export const activeSeasonCache = sqliteTable('active_season_cache', {
  id: integer('id').primaryKey().default(1),
  seasonId: text('season_id').notNull(),
  candidatesJson: text('candidates_json').notNull(),
});

/** Provides the shared bridge config value. */

export const bridgeConfig = sqliteTable("bridge_config", {
  id: integer("id").primaryKey().default(1),
  ip: text("ip"),
  port: integer("port"),
  token: text("token"),
  deviceId: text("device_id"),
  deviceName: text("device_name"),
  lastChangelogId: integer("last_changelog_id").default(0),
  // User-owned kill switch for diagnostic telemetry. Defaults to ON so a device that hits the
  // failure before anyone opens Settings still reports it, which is the whole point; turning it
  // off stops the payload from being built or sent at all, not merely ignored downstream.
  isSyncTelemetryEnabled: integer("is_sync_telemetry_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
});

/** Provides the shared pending remote changes value. */

export const pendingRemoteChanges = sqliteTable("pending_remote_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recordId: text("record_id").notNull(),
  changeType: text("change_type").notNull(),
  changedFields: text("changed_fields").notNull(),
  snapshot: text("snapshot"),
  timestamp: integer("timestamp").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** Provides the shared sync runtime status value. */

export const syncRuntimeStatus = sqliteTable('sync_runtime_status', {
  id: integer('id').primaryKey().default(1),
  registrationStatus: text('registration_status')
    .$type<SyncRuntimeRegistrationStatus>()
    .notNull()
    .default('unregistered'),
  executionMode: text('execution_mode')
    .$type<SyncExecutionMode>()
    .notNull()
    .default('best_effort_background_task'),
  isForegroundServiceRunning: integer('is_foreground_service_running', { mode: 'boolean' })
    .notNull()
    .default(false),
  canShowPersistentNotification: integer('can_show_persistent_notification', { mode: 'boolean' })
    .notNull()
    .default(false),
  lastAttemptAt: integer('last_attempt_at'),
  lastSuccessAt: integer('last_success_at'),
  lastFailureMessage: text('last_failure_message'),
  lastTriggerSource: text('last_trigger_source').$type<SyncRuntimeTriggerSource>(),
  lastSyncedCount: integer('last_synced_count').notNull().default(0),
  foregroundServiceCallbackStartedAt: integer('foreground_service_callback_started_at'),
  lastNoOpReason: text('last_no_op_reason'),
  lastPendingOperationsCountAtStart: integer('last_pending_operations_count_at_start'),
  isCycleActive: integer('is_cycle_active', { mode: 'boolean' }).notNull().default(false),
  lastBacklogReadCount: integer('last_backlog_read_count').notNull().default(0),
  lastPrunedOperationsCount: integer('last_pruned_operations_count').notNull().default(0),
  isBackgroundTaskRegistered: integer('is_background_task_registered', { mode: 'boolean' })
    .notNull()
    .default(false),
  // Cycle post-mortem columns. A cycle killed by the host cannot report its own death, so the
  // NEXT cycle reads these to reconstruct what happened. Each column answers a question that
  // otherwise requires a USB cable and `adb logcat`.
  lastCycleId: text('last_cycle_id'),
  lastCycleStage: text('last_cycle_stage').$type<SyncCycleStage>(),
  lastErrorName: text('last_error_name'),
  lastNativeErrcodeByte: integer('last_native_errcode_byte'),
  lastErrorStage: text('last_error_stage'),
  consecutiveUnclosedCycles: integer('consecutive_unclosed_cycles').notNull().default(0),
  // Instant the last checkpoint was taken. Without it, a `never_closed` cycle can only report
  // `now - started_at`, which includes the gap until the NEXT cycle fired -- that measures how
  // long ago it started, not how long it ran. With it, the duration is measured inside the cycle.
  lastCycleStageAt: integer('last_cycle_stage_at'),
  // Checkpoints that failed to persist during the last cycle. A checkpoint swallows its own
  // errors so the instrument can never break the cycle, but silence would make a stale
  // `last_cycle_stage` indistinguishable from an accurate one. Zero means the stage is
  // trustworthy; anything else marks it as degraded rather than quietly wrong.
  lastFailedCheckpointCount: integer('last_failed_checkpoint_count').notNull().default(0),
  // Convergence-instrumentation columns (design.md `2026-09-09-convergence-instrumentation`
  // Decision 6). All eight are additive and NULLABLE with no default: a row that predates this
  // change, or a cycle that never reached the folded bookkeeping write, must read back NULL --
  // never a plausible zero, which would misreport "no lost edits" (Decision 7's false-answer
  // defect class). They fold into the SAME write `recordBacklogReadCount` already performs, so
  // this table gains zero new write-door transactions.
  lastDiagnosticsDiscardedCount: integer('last_diagnostics_discarded_count'),
  lastDiagnosticsFailedRemovalCount: integer('last_diagnostics_failed_removal_count'),
  lastOutboxFailedWriteCount: integer('last_outbox_failed_write_count'),
  lastDeadLetterCount: integer('last_dead_letter_count'),
  lastConflictExhaustedCount: integer('last_conflict_exhausted_count'),
  lastStuckProcessingCount: integer('last_stuck_processing_count'),
  lastOldestPendingAgeMs: integer('last_oldest_pending_age_ms'),
  // TRUE `operation_log` backlog depth (`OperationLogConvergence.pendingRowCount`), never the
  // bounded per-cycle batch size. `hasMore` is DERIVED from this at read time (Decision 1),
  // never stored, so it can never go stale against the count beside it.
  lastPendingRowCount: integer('last_pending_row_count'),
});

/** Defines the anime row value shape. */
export type AnimeRow = typeof animes.$inferSelect;
/** Defines the insert anime row value shape. */
export type InsertAnimeRow = typeof animes.$inferInsert;
/** Defines the operation log row value shape. */
export type OperationLogRow = typeof operationLog.$inferSelect;
/** Defines the insert operation log row value shape. */
export type InsertOperationLogRow = typeof operationLog.$inferInsert;
/** Defines the season rating queue row value shape. */
export type SeasonRatingQueueRow = typeof seasonRatingQueue.$inferSelect;
/** Defines the insert season rating queue row value shape. */
export type InsertSeasonRatingQueueRow = typeof seasonRatingQueue.$inferInsert;
/** Defines the active season cache row value shape. */
export type ActiveSeasonCacheRow = typeof activeSeasonCache.$inferSelect;
/** Defines the new active season cache row value shape. */
export type NewActiveSeasonCacheRow = typeof activeSeasonCache.$inferInsert;
/** Defines the pending remote change row value shape. */
export type PendingRemoteChangeRow = typeof pendingRemoteChanges.$inferSelect;
/** Defines the insert pending remote change row value shape. */
export type InsertPendingRemoteChangeRow = typeof pendingRemoteChanges.$inferInsert;
/** Defines the bridge config value shape. */
export type BridgeConfig = typeof bridgeConfig.$inferSelect;
/** Defines the new bridge config value shape. */
export type NewBridgeConfig = typeof bridgeConfig.$inferInsert;
/** Defines the sync runtime status row value shape. */
export type SyncRuntimeStatusRow = typeof syncRuntimeStatus.$inferSelect;
/** Defines the new sync runtime status row value shape. */
export type NewSyncRuntimeStatusRow = typeof syncRuntimeStatus.$inferInsert;
