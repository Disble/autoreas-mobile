import { STARTUP_LOCAL_OPERATION_DEADLINE_MS } from '../../../../src/features/startup/startup.constants';
import {
  createStartupDiagnostic,
  isRetryableStartupDiagnostic,
  withStartupDeadline,
} from '../../../../src/features/startup/startup.helpers';

describe('isRetryableStartupDiagnostic', () => {
  it.each([
    {
      name: 'retries SQLITE_BUSY (busy)',
      error: Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' }),
      classification: 'busy',
      retries: true,
    },
    {
      name: 'retries SQLITE_LOCKED (busy)',
      error: Object.assign(new Error('SQLITE_LOCKED: table is locked'), { code: 'SQLITE_LOCKED' }),
      classification: 'busy',
      retries: true,
    },
    {
      name: 'does not retry SQLITE_CORRUPT (corruption)',
      error: Object.assign(new Error('SQLITE_CORRUPT: database disk image is malformed'), {
        code: 'SQLITE_CORRUPT',
      }),
      classification: 'corruption',
      retries: false,
    },
    {
      name: 'does not retry SQLITE_NOTADB (corruption)',
      error: Object.assign(new Error('SQLITE_NOTADB: file is not a database'), {
        code: 'SQLITE_NOTADB',
      }),
      classification: 'corruption',
      retries: false,
    },
    {
      name: 'does not retry SQLITE_SCHEMA (incompatible_schema)',
      error: Object.assign(new Error('SQLITE_SCHEMA: database schema has changed'), {
        code: 'SQLITE_SCHEMA',
      }),
      classification: 'incompatible_schema',
      retries: false,
    },
    {
      name: 'does not retry a SchemaValidationError (schema_validation)',
      error: Object.assign(new Error('foreign key mismatch in operation_log'), {
        name: 'SchemaValidationError',
      }),
      classification: 'schema_validation',
      retries: false,
    },
    {
      name: 'does not retry a whitelisted non-lock code like SQLITE_ERROR (sqlite)',
      error: Object.assign(new Error('SQLITE_ERROR: unrecognized token'), { code: 'SQLITE_ERROR' }),
      classification: 'sqlite',
      retries: false,
    },
    {
      name: 'does not retry a plain error with no code (unknown)',
      error: new Error('boom'),
      classification: 'unknown',
      retries: false,
    },
  ])('$name', ({ error, classification, retries }) => {
    const diagnostic = createStartupDiagnostic('database_preparation', error);

    expect(diagnostic.classification).toBe(classification);
    expect(isRetryableStartupDiagnostic(diagnostic)).toBe(retries);
  });
});

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
