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
      // Plain-Node investigation harness (node:sqlite + worker_threads). It never
      // ships and never runs under jest or Metro, so the React Native lint profile
      // — which provides no Node globals — does not apply to it.
      'tests/sqlite-lab/**',
    ],
  },
  ...createRecommendedConfig({
    infrastructure: {
      importPatterns: ['(^|/)infrastructure(/|$)'],
    },
  }),
  {
    // Write-door boundary (sqlite-write-lock-contention design.md Decision 8). dlinter's
    // `infrastructure` edge above governs import specifiers and runtime globals, not method
    // calls, so it cannot express "route every write through withLocalWrite". This block fills
    // that gap directly: feature code may not call the raw SQLite write/transaction methods --
    // it must go through withLocalWrite (src/infrastructure/db/client) and use the `tx` handle
    // that door provides. ESLint cannot statically prove an arbitrary identifier IS that `tx`
    // handle, so the exemption is fixed by convention: only a callee object literally named `tx`
    // is exempt. Reads (getAllAsync/getFirstAsync) are intentionally NOT restricted here.
    files: ['src/features/**/*.ts', 'src/features/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(runAsync|runSync|execAsync|execSync|with\\w*TransactionAsync)$/]:not([callee.object.name='tx'])",
          message:
            'Feature code must not call the raw SQLite connection directly (a write bypassing the write door reintroduces lock contention -- local-write-serialization spec). Route the write through withLocalWrite (src/infrastructure/db/client) and use its `tx` callback parameter for statements inside the transaction.',
        },
      ],
    },
  },
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
