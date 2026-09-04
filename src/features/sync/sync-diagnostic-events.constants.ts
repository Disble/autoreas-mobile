/**
 * Where in the app an event was observed.
 *
 * This is a closed vocabulary for the same reason every other transport field is: the bridge
 * stores reconcile request bodies verbatim and unsanitized. Shipping the app's real log LINES
 * would carry database paths, URLs with the user's LAN address, SQL fragments and bound values --
 * and in this app the bound values are anime titles. So the diagnostic feed transmits symbols,
 * never text.
 */
export const SYNC_DIAGNOSTIC_SOURCES = [
  'sync_cycle',
  'websocket',
  'mutation',
  'foreground_resync',
  'background_task',
  'startup',
] as const;

/**
 * What was observed. Each member exists to answer a question that this session could only
 * answer with a USB cable:
 * - `ws_opened` / `ws_closed` -> two opens 126 ms apart is how the duplicate-socket bug shows.
 * - `ws_reconnect_scheduled` -> separates "the socket is retrying" from "the socket gave up",
 *   which look identical from the bridge when no client is connected.
 * - `mutation_failed` -> the local write never landed; the dead +/- button.
 * - `mutation_sync_failed` -> the write landed locally but never reached the bridge. Different bug.
 * - `resync_failed` / `write_failed` -> the foreground paths, which the cycle post-mortem misses
 *   entirely because they are not a cycle.
 * - `headless_task_registered` / `headless_task_missing` -> whether the host kept JS timers
 *   alive. Its absence is what makes every deadline in the app silently dead in background,
 *   and today it is only observable through `adb logcat`.
 */
export const SYNC_DIAGNOSTIC_EVENTS = [
  'ws_opened',
  'ws_closed',
  'ws_error',
  'ws_reconnect_scheduled',
  'mutation_failed',
  'mutation_sync_failed',
  'resync_failed',
  'write_failed',
  'headless_task_registered',
  'headless_task_missing',
] as const;

/**
 * How many distinct entries the ring keeps.
 *
 * Small on purpose. Entries COALESCE by (source, event, cause), so a fault repeating 48 times
 * occupies one slot with a count rather than 48 slots -- which is what keeps a wide budget from
 * being necessary, and what stops one loud fault from evicting every other signal. Twenty
 * distinct kinds of trouble at once is already far past the point where the answer is obvious.
 */
export const SYNC_DIAGNOSTIC_EVENT_RING_SIZE = 20;
