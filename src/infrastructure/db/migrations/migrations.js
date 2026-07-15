// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_moaning_maximus.sql';
import m0001 from './0001_add_bridge_config_last_changelog_id.sql';
import m0002 from './0002_add_sync_runtime_status.sql';
import m0003 from './0003_add_sync_execution_mode.sql';
import m0004 from './0004_add_foreground_sync_diagnostics.sql';
import m0005 from './0005_add_operation_log_retention_support.sql';
import m0006 from './0006_sanitize_bridge_config_changelog_cursor.sql';
import m0007 from './0007_add_animes_last_applied_change_ms.sql';
import m0008 from './0008_add_pending_remote_changes.sql';
import m0009 from './0009_add_season_rating_queue.sql';

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
    m0004,
    m0005,
    m0006,
    m0007,
    m0008,
    m0009,
  },
};
