/** Builds the per-file `coverageThreshold` map from the CORE/IMPORTANT tier lists. */
const { buildCoverageThreshold } = require('./jest.coverage-tiers');

module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/tests'],
  // Gesture Handler 3 needs its own native-module mocks under Jest; Jest appends this to the preset's
  // setup files.
  setupFiles: ['react-native-gesture-handler/jestSetup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Reanimated 4.7's resolver loads its web-only modules (and Worklets' non-native files) under Jest;
  // without it the native initializer runs against JSReanimated and throws at import time. It replaces
  // the preset's React Native resolver, which Jest 30 already reduces to the default resolver.
  resolver: 'react-native-reanimated/jest/resolver',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo/.*|expo-router|@react-navigation/.*|react-native-svg|react-native-reanimated|react-native-worklets|react-native-gesture-handler|heroui-native|uniwind|standard-navigation))',
  ],
  cacheDirectory: '<rootDir>/.jest/cache',
  coverageDirectory: '<rootDir>/coverage',
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  // Per-file coverage tiers (maintainer's 100/80/0 policy). No `global` key: an unlisted file
  // is INFRA and gets no gate. See jest.coverage-tiers.js and
  // odd/tasks/sync-core-test-assurance.md for the tier list and the rationale.
  coverageThreshold: buildCoverageThreshold(),
};
