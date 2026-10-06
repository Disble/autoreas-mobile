/**
 * How long background sync must have gone without an attempt before the one-time reminder may
 * appear. The native foreground service records an attempt every tick (~15 s), even when the
 * bridge is down, so two hours of silence means the OS stopped the service, not that the network
 * failed. The same window must also have elapsed since the first prompt, so the reminder never
 * follows the prompt immediately.
 */
export const BACKGROUND_SILENCE_THRESHOLD_MS = 2 * 60 * 60 * 1_000;
