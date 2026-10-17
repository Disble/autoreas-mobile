/**
 * How strongly one dispatched cycle asks for the full-snapshot heal (ADR 009 R-7): `always` on
 * mount and resume, `if_stale` on a WebSocket reconnect (only when the last successful heal is more
 * than `SNAPSHOT_HEAL_STALE_AFTER_MS` old), `never` for every other trigger.
 */
export type SnapshotHealDemand = 'always' | 'if_stale' | 'never';
