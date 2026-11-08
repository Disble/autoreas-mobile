/**
 * The diagnostics kind a counted attempt reaches the bridge as: the native diary folds every count
 * into one `hourly_summary` per closed hour. The recorder asks the accepted-kind registry about
 * this kind before it counts, the same decision every other producer consults.
 */
export const SYNC_ATTEMPT_DIARY_SUMMARY_KIND = 'hourly_summary';
