import {
  STARTUP_LOCAL_OPERATION_DEADLINE_MS,
  STARTUP_PROVIDER_READINESS_DEADLINE_MS,
  STARTUP_SOFT_DEADLINE_MS,
} from '../../../../src/features/startup/startup.constants';
import { SQLITE_BUSY_TIMEOUT_MS } from '../../../../src/infrastructure/db/startup/startup.constants';

describe('foreground startup timing constants form one total order', () => {
  it('lets the SQLite busy wait finish inside the startup deadline', () => {
    // These two used to be EQUAL (5000 vs 5000), and that equality was the defect: the
    // connection was authorized to wait the full budget the wrapper needed for the whole
    // operation, so a single transient lock wait was guaranteed to surface as the fatal
    // startup card. The strict `<` is what makes the inner allowance reachable at all.
    expect(SQLITE_BUSY_TIMEOUT_MS).toBeLessThan(STARTUP_LOCAL_OPERATION_DEADLINE_MS);
  });

  it('leaves room for at least one bounded retry after a failed lock wait', () => {
    // The busy handler already retries inside one attempt; when that attempt exhausts its own
    // window, the caller needs budget left for a fresh one, or the retry policy in
    // `createStartupDatabaseInitializer` can never run.
    expect(STARTUP_LOCAL_OPERATION_DEADLINE_MS).toBeGreaterThanOrEqual(
      2 * SQLITE_BUSY_TIMEOUT_MS,
    );
  });

  it('announces the slow phase only after one full lock wait can have elapsed', () => {
    // The soft boundary is an observation, not a verdict. Placing it below the busy wait would
    // tell the user "this is taking longer than usual" while the connection is still inside its
    // own allowance, which is exactly the false alarm this ordering exists to remove.
    expect(SQLITE_BUSY_TIMEOUT_MS).toBeLessThan(STARTUP_SOFT_DEADLINE_MS);
    expect(STARTUP_SOFT_DEADLINE_MS).toBeLessThan(STARTUP_LOCAL_OPERATION_DEADLINE_MS);
  });

  it('keeps the provider watchdog outside the work it wraps', () => {
    // The watchdog envelopes database preparation AND the local configuration read. If it fired
    // first it would report `provider_readiness` for work that is still inside its own budget,
    // and which of the two messages the user sees would be decided by timer order.
    expect(STARTUP_LOCAL_OPERATION_DEADLINE_MS).toBeLessThan(
      STARTUP_PROVIDER_READINESS_DEADLINE_MS,
    );
  });
});
