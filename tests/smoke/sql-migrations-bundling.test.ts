import bundledMigration from '../fixtures/sql/sample-migration.sql';

describe('sql migrations bundling bootstrap', () => {
  it('inlines .sql files as strings through Babel', () => {
    expect(typeof bundledMigration).toBe('string');
    expect(bundledMigration).toContain('CREATE TABLE operation_log');
    expect(bundledMigration).toContain('payload TEXT NOT NULL');
  });
});
