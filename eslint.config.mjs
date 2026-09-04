// `dlinter-ts-react` is deprecated and has been removed. It was a preset that bundled other
// people's plugins, so dropping it dropped 540 active rules at once -- 231 react-doctor, 205
// sonarjs, 38 @typescript-eslint, and the rest. The plugins worth keeping are wired directly
// below instead, which is why `eslint-plugin-react-doctor` was already a direct dependency here
// and did not need dlinter to reach it.
//
// `sonarjs` is deliberately NOT reinstated: its rules are the ESLint port of SonarQube's own
// ruleset, and this project analyses that surface through SonarQube instead of at commit time.
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import-x';
import reactDoctor from 'eslint-plugin-react-doctor';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
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
  {
    // react-doctor, wired directly rather than through the deprecated preset. `recommended` and
    // `react-native` are plain config objects, not flat arrays, so their rule maps are merged
    // here explicitly; the RN set is additive (40 rules) on top of the base (581).
    //
    // CLAUDE.md constraint 10 requires react-doctor to report 100/100 after React changes, so
    // this is the one part of the removed preset that could not simply be dropped.
    files: ['**/*.{js,jsx,ts,tsx,mjs,cjs}'],
    plugins: {
      ...reactDoctor.configs.recommended.plugins,
      ...reactDoctor.configs['react-native'].plugins,
    },
    rules: {
      ...reactDoctor.configs.recommended.rules,
      ...reactDoctor.configs['react-native'].rules,
      // Turned off because it contradicts a documented project constraint, not because it is
      // noisy. The Hook Anatomy Rule (CLAUDE.md rule 2) prescribes a fixed order in which step 5
      // is `useMemo` and step 6 is `useCallback`, so every hook in this codebase memoises by hand
      // on purpose. This rule flagged 123 of them. One of the two has to give, and the repo-wide
      // convention outranks a lint default that assumes the React Compiler is doing the work.
      'react-doctor/react-compiler-no-manual-memoization': 'off',
    },
  },
  {
    // The 51 core rules the preset supplied. `js.configs.recommended` is exactly that set, so
    // dropping the preset does not cost a single one of them.
    files: ['**/*.{js,jsx,ts,tsx,mjs,cjs}'],
    ...js.configs.recommended,
  },
  {
    // TypeScript, syntax-only -- deliberately matching what the removed preset ACHIEVED rather
    // than what it declared.
    //
    // The preset declared 23 type-aware rules at `error` (`no-floating-promises`,
    // `no-misused-promises`, `require-await`, the `no-unsafe-*` family) but never configured
    // `parserOptions.project`, and a type-aware rule without a program resolves nothing and
    // reports nothing. Measured: enabling them properly here surfaced 484 findings on code that
    // linted clean for as long as the preset was installed. They were switched on and blind.
    //
    // Turning them on for real is worth doing -- they are the only rules that can see an
    // un-awaited promise, which is this codebase's recurring defect -- but it is a separate
    // decision with 484 findings attached, not a side effect of deleting a deprecated preset.
    // Restore `recommended-type-checked` plus `parserOptions: { projectService: true }` to take it.
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: typescriptParser },
    plugins: { '@typescript-eslint': typescriptEslint },
    rules: {
      ...typescriptEslint.configs.recommended.rules,
      // TypeScript already proves every identifier resolves, and with the real module graph
      // rather than a globals list. Leaving core `no-undef` on for TS is the documented
      // typescript-eslint anti-pattern: it reported 4949 findings here, every one of them a name
      // the compiler already knows. The preset had it off for the same reason.
      'no-undef': 'off',
    },
  },
  {
    // Import graph rules. `no-cycle` and `no-unresolved` are the two that carry weight here: a
    // cycle between a feature's helpers and its barrel is exactly the shape this codebase keeps
    // producing, and neither the core set nor react-doctor can see it.
    files: ['**/*.{js,jsx,ts,tsx,mjs,cjs}'],
    plugins: { 'import-x': importPlugin },
    rules: {
      'import-x/no-cycle': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-named-as-default': 'error',
      'import-x/no-named-as-default-member': 'error',
    },
  },
  {
    // `max-lines` came from the preset, not from any plugin's recommended set, and the 500-line
    // ceiling is a documented project constraint (CLAUDE.md rule 5) -- so it is restored by hand
    // rather than inherited. Without this the ceiling would be convention only, which is how the
    // Bridge Boundary rule already decayed.
    files: ['**/*.{js,jsx,ts,tsx,mjs,cjs}'],
    rules: {
      'max-lines': ['error', { max: 500, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    // Write-door boundary (sqlite-write-lock-contention design.md Decision 8). This used to be
    // described as filling a gap left by the removed preset's `infrastructure` edge, which
    // governed import specifiers rather than method calls. That edge is gone with the preset, so
    // these selectors are now the only thing expressing "route every write through
    // withLocalWrite" -- nothing else in the config can see a method call on a connection.
    // Feature code may not call the raw SQLite write/transaction methods --
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
