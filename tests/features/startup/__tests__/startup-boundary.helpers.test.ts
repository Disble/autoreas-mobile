import { createStartupDiagnostic } from '../../../../src/features/startup/startup.helpers';
import { SchemaValidationError } from '../../../../src/infrastructure/db/startup';

describe('startup boundary helpers', () => {
  it('reduces native SQLite failures to whitelisted stage and code diagnostics', () => {
    const error = new Error(
      'SQLITE_BUSY: UPDATE bridge_config SET token = secret-token at 192.168.1.10',
    );

    expect(createStartupDiagnostic('database_preparation', error)).toEqual({
      stage: 'database_preparation',
      code: 'SQLITE_BUSY',
      classification: 'busy',
    });
  });

  it('classifies controlled schema validation failures without exposing a native message', () => {
    expect(
      createStartupDiagnostic('database_preparation', new SchemaValidationError()),
    ).toEqual({
      stage: 'database_preparation',
      code: null,
      classification: 'schema_validation',
    });
  });
});
