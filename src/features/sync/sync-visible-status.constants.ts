/**
 * Hours without a successful sync after which a pending backlog turns the status to `warning`.
 * Waiting never escalates further: the changes stay stored on the device and are retried automatically.
 */
export const SYNC_VISIBLE_STATUS_STALE_WARNING_HOURS = 72;

/** Milliseconds in one minute, used to format the recency of the last sync. */
export const SYNC_VISIBLE_STATUS_MINUTE_MS = 60 * 1000;

/** Milliseconds in one hour, used to compare a backlog's age with the stale threshold. */
export const SYNC_VISIBLE_STATUS_HOUR_MS = 60 * SYNC_VISIBLE_STATUS_MINUTE_MS;

/** Milliseconds in one day, used to report how many whole days passed without a sync. */
export const SYNC_VISIBLE_STATUS_DAY_MS = 24 * SYNC_VISIBLE_STATUS_HOUR_MS;
