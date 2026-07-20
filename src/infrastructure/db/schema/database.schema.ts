import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type {
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
