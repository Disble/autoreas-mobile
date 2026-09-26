/**
 * On-demand mutation run over the CORE sync tier (`bun run test:mutation:core`).
 *
 * Deliberately NOT part of pre-commit: measured on 2026-09-24, one CORE file
 * (`anime-mutation.helpers.ts`, 108 mutants) took 284 s, and the whole tier is ~1700 mutants
 * (roughly 75 min). The per-commit guarantee for CORE is the 100 % coverage gate in
 * jest.coverage-tiers.js; this run checks that the coverage is actually asserted.
 * See odd/tasks/sync-core-test-assurance.md (T4).
 *
 * `--unhandled-rejections=warn`: the fire-and-forget sync in anime-mutation.helpers.ts lets some
 * mutants surface an unhandled rejection, which by default kills the Jest worker and makes Stryker
 * respawn it in a loop (observed: 40 respawns, then the run was killed for memory). As a warning,
 * the mutant is scored normally.
 */
const { CORE_FILES } = require('./jest.coverage-tiers');

/** Stryker configuration for the CORE tier mutation run. */
module.exports = {
  testRunner: 'jest',
  plugins: ['@stryker-mutator/jest-runner'],
  mutate: CORE_FILES,
  concurrency: 2,
  testRunnerNodeArgs: ['--unhandled-rejections=warn'],
  ignoreStatic: true,
  cleanTempDir: 'always',
  tempDirName: '.stryker-core-tmp',
  reporters: ['clear-text', 'html'],
  htmlReporter: { fileName: 'reports/mutation/core.html' },
  ignorePatterns: ['.codegraph', '.expo', '.jest', 'coverage', 'android', 'ios', 'node_modules', 'reports'],
  // Report-only until a full baseline exists: `break: null` never fails the run. Raise it to the
  // measured tier score once the baseline is recorded in the feature document.
  thresholds: { high: 80, low: 60, break: null },
  jest: {
    projectType: 'custom',
    configFile: 'jest.config.js',
    enableFindRelatedTests: true,
    config: { maxWorkers: 2 },
  },
};
