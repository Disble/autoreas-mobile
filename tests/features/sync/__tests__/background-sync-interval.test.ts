import {
  BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES,
  BACKGROUND_SYNC_TASK_OPTIONS,
} from '../../../../src/features/sync/background-sync.constants';

describe('background sync scheduling interval', () => {
  it('asks the platform for 15 minutes, in the unit the platform actually reads', () => {
    // `expo-background-task` reads `minimumInterval` in MINUTES. The previous value was
    // `15 * 60`, written as though it were seconds, which requested 900 minutes -- a 15 hour
    // floor. Three prior designs reasoned from a 15-minute fallback that never once ran.
    expect(BACKGROUND_SYNC_TASK_OPTIONS.minimumInterval).toBe(15);
  });

  it('never expresses the interval in seconds', () => {
    // 900 is the exact value of the original defect. Pinning it by name means a future edit
    // that reintroduces `15 * 60` fails here rather than silently costing another release.
    expect(BACKGROUND_SYNC_TASK_OPTIONS.minimumInterval).not.toBe(900);
    expect(BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES).toBe(15);
  });
});
