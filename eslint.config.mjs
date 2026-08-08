// dlinter-ts-react v0.9.0 integration (real test)
// The Bridge Boundary that previously lived as hand-rolled no-restricted-syntax
// selectors is now expressed as dlinter's infrastructure edge.
import { createRecommendedConfig } from 'dlinter-ts-react';

export default [
  {
    // `.agents/` and `.claude/` hold vendored agent-skill scripts that ship with their own
    // runtime assumptions; linting them produced 175 `no-undef` errors about code this repo
    // does not own or execute. `coverage/` and the Stryker sandbox are generated output.
    ignores: [
      'uniwind-types.d.ts',
      'uniwind.d.ts',
      '.agents/**',
      '.claude/**',
      'coverage/**',
      '.dlinter-mutation-tmp/**',
    ],
  },
  ...createRecommendedConfig({
    infrastructure: {
      importPatterns: ['(^|/)infrastructure(/|$)'],
    },
  }),
  {
    // Expo config plugins are CommonJS by contract: `expo/config-plugins` loads them through
    // require(), so they cannot be ESM. They were missing here only because lint runs on staged
    // files and nothing had staged plugins/ since this block was written.
    files: [
      'jest.config.js',
      'metro.config.js',
      'scripts/generate-feature.js',
      'plugins/*.js',
    ],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        module: 'readonly',
        require: 'readonly',
      },
    },
  },
];
