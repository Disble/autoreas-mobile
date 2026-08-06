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
};
