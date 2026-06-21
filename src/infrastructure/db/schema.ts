import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type {
  SyncRuntimeRegistrationStatus,
  SyncRuntimeTriggerSource,
} from '../../features/sync/sync-runtime-status.types';
import type { SyncExecutionMode } from '../../features/sync/sync-execution-mode.types';

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

export const bridgeConfig = sqliteTable("bridge_config", {
  id: integer("id").primaryKey().default(1),
  ip: text("ip"),
  port: integer("port"),
  token: text("token"),
  deviceId: text("device_id"),
  deviceName: text("device_name"),
  lastChangelogId: integer("last_changelog_id").default(0),
});

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
});

export type AnimeRow = typeof animes.$inferSelect;
export type InsertAnimeRow = typeof animes.$inferInsert;
export type OperationLogRow = typeof operationLog.$inferSelect;
export type InsertOperationLogRow = typeof operationLog.$inferInsert;
export type BridgeConfig = typeof bridgeConfig.$inferSelect;
export type NewBridgeConfig = typeof bridgeConfig.$inferInsert;
export type SyncRuntimeStatusRow = typeof syncRuntimeStatus.$inferSelect;
export type NewSyncRuntimeStatusRow = typeof syncRuntimeStatus.$inferInsert;
