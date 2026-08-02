import { STARTUP_LOCAL_OPERATION_DEADLINE_MS } from '../../../../src/features/startup/startup.constants';
import { withStartupDeadline } from '../../../../src/features/startup/startup.helpers';

describe('withStartupDeadline', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects a non-settling operation when its deadline expires', async () => {
    const operation = withStartupDeadline(
      new Promise<never>(() => undefined),
      STARTUP_LOCAL_OPERATION_DEADLINE_MS,
    );
    const rejection = expect(operation).rejects.toThrow('Startup operation deadline exceeded');

    await jest.advanceTimersByTimeAsync(STARTUP_LOCAL_OPERATION_DEADLINE_MS);

    await rejection;
  });
});
