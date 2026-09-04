// dlinter-ts-react v0.9.0 integration (real test)
// The Bridge Boundary that previously lived as hand-rolled no-restricted-syntax
// selectors is now expressed as dlinter's infrastructure edge.
import { createRecommendedConfig } from 'dlinter-ts-react';
// dharness:eslint-import begin — rewritten by `dharness sync`; edits here are lost.
import dharnessPlugin from "dharness-eslint-plugin";
import dharnessExpo from "eslint-config-expo/flat.js";
import dharnessLayer from "./.dharness/eslint.config.mjs";
// dharness:eslint-import end

export default [
  // dharness:eslint-layer begin — rewritten by `dharness sync`; edits here are lost.
  ...dharnessLayer({ plugin: dharnessPlugin, dharnessExpo }),
  // dharness:eslint-layer end
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
        {
          selector:
            "CallExpression[callee.name='withLocalWrite'] CallExpression[callee.object.name='bridgeClient']",
          message:
            'No bridge call inside a write door. withLocalWrite holds BEGIN IMMEDIATE on the connection, so an unbounded network await inside it jams that database file for every other writer -- and a JS timer cannot cancel native SQLite work, so the door cannot be opened to recover. Do the network call BEFORE or AFTER the door and pass the result in (see reconcile.helpers.ts, which reconciles between doors).',
        },
        {
          selector:
            "CallExpression[callee.name='withLocalWrite'] CallExpression[callee.name='fetch']",
          message:
            'No raw fetch inside a write door (and no raw fetch in feature code at all -- transport belongs to src/infrastructure/api). A network await inside withLocalWrite jams the write door for every writer on that database file.',
        },
      ],
    },
  },
  {
    // Same no-unbounded-IO-inside-the-door rule, for infrastructure. It needs its own config
    // object rather than a widened `files` glob: two flat-config entries that both define
    // `no-restricted-syntax` do NOT merge their selector arrays -- the later one replaces the
    // earlier for any file both match. Overlapping globs here would silently disable the write
    // door selector above for every file under src/features.
    files: ['src/infrastructure/**/*.ts', 'src/infrastructure/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name='withLocalWrite'] CallExpression[callee.object.name='bridgeClient']",
          message:
            'No bridge call inside a write door. withLocalWrite holds BEGIN IMMEDIATE on the connection, so an unbounded network await inside it jams that database file for every other writer -- and a JS timer cannot cancel native SQLite work, so the door cannot be opened to recover. Do the network call BEFORE or AFTER the door and pass the result in (see reconcile.helpers.ts, which reconciles between doors).',
        },
        {
          selector:
            "CallExpression[callee.name='withLocalWrite'] CallExpression[callee.name='fetch']",
          message:
            'No raw fetch inside a write door (and no raw fetch in feature code at all -- transport belongs to src/infrastructure/api). A network await inside withLocalWrite jams the write door for every writer on that database file.',
        },
      ],
    },
  },
  {
    // Expo config plugins are CommonJS by contract: `expo/config-plugins` loads them through
    // require(), so they cannot be ESM. They were missing here only because lint runs on staged
    // files and nothing had staged plugins/ since this block was written.
    files: [
      'babel.config.js',
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
