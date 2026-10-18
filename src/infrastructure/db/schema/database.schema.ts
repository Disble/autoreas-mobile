import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SyncRuntimeRegistrationStatus } from '../../../features/sync/sync-runtime-status.types';
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
  // Bridge per-episode durations as JSON text (`[{ episode, minutes, long }]`); NULL = none known.
  episodes: text("episodes"),
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
  // Bridge folder path below its library root (`folderRelative` on the wire, `/`-separated);
  // NULL = no path sent, so the device falls back to matching the folder by name.
  folderRelative: text("folder_relative"),
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
  // Bridge season candidacy as JSON text (`{ seasonId, grade }`); NULL = not a candidate.
  season: text("season"),
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
    // ADR 009 R-13 per-key claim: the runtime holding this anime ('js' | 'native') and when it
    // took the claim. NULL means unclaimed; a claim older than 60 s is expired.
    claimOwner: text("claim_owner"),
    claimedAt: integer("claimed_at"),
    // ADR 009 R-16(b): why a row was given up when its status alone cannot say (fetch-first
    // outcomes `bridge_404` and `token_missing`). NULL on every row that is not unresolved.
    unresolvedReason: text("unresolved_reason"),
  },
  (table) => [
    index('operation_log_status_created_at_idx').on(
      table.status,
      table.createdAt,
      table.id,
    ),
  ],
);

/**
 * Provides the single-row app preferences that must survive re-pairing. Kept out of
 * `bridge_config` on purpose: pairing deletes and reinserts that row. Created only by the
 * `ensureAppPreferencesTable` repair step, never by a migration file.
 */
export const appPreferences = sqliteTable('app_preferences', {
  id: integer('id').primaryKey().default(1),
  batteryPromptShownAt: integer('battery_prompt_shown_at'),
  batteryReminderShownAt: integer('battery_reminder_shown_at'),
  animeFoldersRootUri: text('anime_folders_root_uri'),
  animeFoldersHintDismissedAt: integer('anime_folders_hint_dismissed_at'),
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
  // The last reconcile's `season_mode`: whether the bridge has a season open.
  seasonMode: integer("season_mode", { mode: "boolean" }).notNull().default(false),
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
  canShowPersistentNotification: integer('can_show_persistent_notification', { mode: 'boolean' })
    .notNull()
    .default(false),
  lastAttemptAt: integer('last_attempt_at'),
  lastSuccessAt: integer('last_success_at'),
  // The last cycle's identity, stage and error class: the native engine and the JS attempt
  // bookkeeping write them, and the device verifier prints them as evidence. Every other column
  // this table once carried had no reader and was dropped by migration `0020` (convergent-sync T18).
  lastCycleId: text('last_cycle_id'),
  lastCycleStage: text('last_cycle_stage'),
  lastErrorName: text('last_error_name'),
});

/** Defines the anime row value shape. */
export type AnimeRow = typeof animes.$inferSelect;
/** Defines the insert anime row value shape. */
export type InsertAnimeRow = typeof animes.$inferInsert;
/** Defines the operation log row value shape. */
export type OperationLogRow = typeof operationLog.$inferSelect;
/** Defines the insert operation log row value shape. */
export type InsertOperationLogRow = typeof operationLog.$inferInsert;
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
/** Defines the app preferences row value shape. */
export type AppPreferencesRow = typeof appPreferences.$inferSelect;
