/** Builds the per-file `coverageThreshold` map from the CORE/IMPORTANT tier lists. */
const { buildCoverageThreshold } = require('./jest.coverage-tiers');

module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/tests'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo/.*|expo-router|@react-navigation/.*|react-native-svg|react-native-reanimated|react-native-gesture-handler|heroui-native|uniwind))',
  ],
  cacheDirectory: '<rootDir>/.jest/cache',
  coverageDirectory: '<rootDir>/coverage',
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  // Per-file coverage tiers (maintainer's 100/80/0 policy). No `global` key: an unlisted file
  // is INFRA and gets no gate. See jest.coverage-tiers.js and
  // odd/tasks/sync-core-test-assurance.md for the tier list and the rationale.
  coverageThreshold: buildCoverageThreshold(),
};
