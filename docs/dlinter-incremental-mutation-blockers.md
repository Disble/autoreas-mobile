# Dlinter Incremental Mutation Testing Blocker

## Summary

`dlinter-ts-react` 0.9.0 requires Vitest for mutation testing while this Expo project keeps Jest and `jest-expo` for its primary suite. The repository now uses a narrow Vitest mutation surface for the pure native foreground-sync ticker helper. Jest remains the Expo integration test runner.

## Current Workflow

Run the bounded suite directly:

```bash
bunx vitest run --config vitest.dlinter-mutation.mts
bunx stryker run stryker.dlinter.json
```

The pre-commit `test:mutation:staged` job runs only when
`src/features/sync/native-foreground-sync-ticker.helpers.ts` is fully staged. It rejects partial staging and uses the generated incremental Stryker cache. Other production files are intentionally outside this initial mutation surface.

The first bounded execution killed 30 of 37 mutants for an 81.08% score, satisfying the generated 80% breaking threshold.

## Observed Evidence

The installed CLI contract is:

```text
Usage: dlinter init [--profile <id>] [--test-mutator]
```

The official 0.9.0 README states that `--test-mutator` requires the resolved surface's `package.json` to declare `vitest` before writing generated artifacts. The published CLI source performs that validation before installing Stryker or writing mutation configuration.

Running the supported mutation initializer produced:

```text
dlinter failed: --test-mutator requires Vitest in the resolved surface package.json.
```

No mutation script, Stryker configuration, Vitest mutation configuration, dependency, or Lefthook mutation job was generated.

The installed CLI also does not implement subcommand-specific help. Running `bunx dlinter init --help` executes `init`; it does not print help. In this repository the additive initialization completed without a tracked diff because the existing dlinter-owned jobs were already present.

## Safe Reproduction

Run these commands from the repository root with an unchanged Git index:

```bash
bunx dlinter --help
bunx dlinter init --test-mutator
```

Do not stage files to reproduce this capability check. Validation fails before staged-file selection or mutation execution.

## Expected Behavior

For an eligible Vitest project, `bunx dlinter init --test-mutator` should:

- install `@stryker-mutator/core@9.6.1` and `@stryker-mutator/vitest-runner@9.6.1`;
- create `scripts/dlinter-mutation-staged.mjs`, `stryker.dlinter.json`, and `vitest.dlinter-mutation.mts`;
- add `test:mutation:staged` with `node ./scripts/dlinter-mutation-staged.mjs`;
- add the staged mutation job to Lefthook;
- skip cleanly when no staged production TypeScript lines exist;
- reject partial staging and enforce an 80% mutation threshold for selected staged lines.

## Actual Behavior

The CLI rejects this Jest project before writing or installing mutation-test artifacts. Therefore no official incremental mutation command is available to execute against a representative scope.

## Environment

- `dlinter-ts-react`: 0.9.0
- CLI binary: repository-local `bunx dlinter`
- Node.js: 22.19.0
- Bun: 1.3.14
- Test runner: Jest 29.7.0 with `jest-expo`
- Platform: Windows

## Impact

The dlinter lint preset and the bounded mutation guard are both configured. The official initializer still cannot create mutation artifacts in a Jest-only repository; Vitest remains a required development dependency for this compatible dual-runner setup.

## Remaining Mutation Gaps

- The default `expo-modules-core` lazy loader is intentionally not executed because the mutation tests inject the native-module lookup seam.
- Removing the null return from the optional-module loader catch path is externally equivalent because the downstream ticker treats both `null` and `undefined` as unavailable.
- Removing optional chaining from `subscription?.remove()` is equivalent while the declared native module contract always returns a subscription from `addListener`.

## Expansion Path

Add another isolated Vitest test file and an explicit Stryker `mutate` entry only after proving a pure helper can run without the Expo/Jest bootstrap. Then rerun:

```bash
bunx vitest run --config vitest.dlinter-mutation.mts
bunx stryker run stryker.dlinter.json --dryRunOnly
```

Do not broaden the mutation scope through the staged hook until its runtime cost is measured and the additional Vitest test surface is proven compatible.
