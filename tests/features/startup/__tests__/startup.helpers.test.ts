import { STARTUP_LOCAL_OPERATION_DEADLINE_MS } from '../../../../src/features/startup/startup.constants';
import {
  createStartupDiagnostic,
  isRetryableStartupDiagnostic,
  withStartupDeadline,
} from '../../../../src/features/startup/startup.helpers';
import {
  SchemaIntegrityError,
  SchemaValidationError,
} from '../../../../src/infrastructure/db/startup';

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
      name: 'does not retry a SchemaIntegrityError (corruption)',
      error: Object.assign(new Error('database disk image is malformed'), {
        name: 'SchemaIntegrityError',
      }),
      classification: 'corruption',
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

describe('startup failure classification boundary', () => {
  it('classifies the real SchemaIntegrityError as corruption and never retries it', () => {
    // Physical damage is a permanent outcome: only a user-authorized reset can clear it, so a
    // bounded busy retry would burn the startup budget on a file that cannot heal itself.
    const diagnostic = createStartupDiagnostic('database_preparation', new SchemaIntegrityError());

    expect(diagnostic).toEqual({
      stage: 'database_preparation',
      code: null,
      classification: 'corruption',
    });
    expect(isRetryableStartupDiagnostic(diagnostic)).toBe(false);
  });

  it('keeps the real SchemaValidationError as schema_validation, not corruption', () => {
    // A missing table or column is a logical mismatch the repair path can fix, so it must not be
    // reported as damage: corruption classification is what authorizes a destructive reset.
    const diagnostic = createStartupDiagnostic('database_preparation', new SchemaValidationError());

    expect(diagnostic).toEqual({
      stage: 'database_preparation',
      code: null,
      classification: 'schema_validation',
    });
    expect(isRetryableStartupDiagnostic(diagnostic)).toBe(false);
  });
});

describe('createStartupDiagnostic classification precedence', () => {
  // The mapping walks an ordered rule table: every error-name rule outranks every code-derived
  // rule. These cases pin that ordering because the corruption classification is the only one
  // that authorizes a user-confirmed reset, so a code branch must never shadow a schema error
  // name and a repairable mismatch must never be reported as damage or retried.
  it.each([
    {
      name: 'puts SchemaIntegrityError before any code rule (corruption wins over busy)',
      error: Object.assign(new Error('SQLITE_BUSY: database is locked'), {
        code: 'SQLITE_BUSY',
        name: 'SchemaIntegrityError',
      }),
      expectedCode: 'SQLITE_BUSY',
      expectedClassification: 'corruption',
    },
    {
      name: 'puts SchemaIntegrityError before the corruption code rule',
      error: Object.assign(new Error('SQLITE_CORRUPT: database disk image is malformed'), {
        code: 'SQLITE_CORRUPT',
        name: 'SchemaIntegrityError',
      }),
      expectedCode: 'SQLITE_CORRUPT',
      expectedClassification: 'corruption',
    },
    {
      name: 'puts SchemaValidationError before any code rule (never busy, never corruption)',
      error: Object.assign(new Error('SQLITE_BUSY: database is locked'), {
        code: 'SQLITE_BUSY',
        name: 'SchemaValidationError',
      }),
      expectedCode: 'SQLITE_BUSY',
      expectedClassification: 'schema_validation',
    },
    {
      name: 'puts SchemaIncompatibleError before the incompatible_schema code rule',
      error: Object.assign(new Error('SQLITE_SCHEMA: database schema has changed'), {
        code: 'SQLITE_SCHEMA',
        name: 'SchemaIncompatibleError',
      }),
      expectedCode: 'SQLITE_SCHEMA',
      expectedClassification: 'incompatible_schema',
    },
  ])('$name', ({ error, expectedCode, expectedClassification }) => {
    const diagnostic = createStartupDiagnostic('database_preparation', error);

    expect(diagnostic).toEqual({
      stage: 'database_preparation',
      code: expectedCode,
      classification: expectedClassification,
    });
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
