# Dlinter Incremental Mutation Testing Blocker

## Summary

`dlinter-ts-react` 0.9.0 is installed, but its incremental mutation capability cannot be configured in this repository because the official CLI supports Vitest projects only. This repository uses Jest and does not declare `vitest`.

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

The dlinter lint preset can be upgraded and validated. Incremental staged-line mutation testing cannot be configured or truthfully reported as passing under the package's official 0.9.0 contract.

## Actionable Next Step

Decide whether this Expo React Native repository should adopt a supported Vitest test surface for mutation testing. If approved, add and validate Vitest compatibility for representative production helpers first, then rerun:

```bash
bunx dlinter init --test-mutator
bun run test:mutation:staged
```

That follow-up must review the generated Vitest include pattern because this repository currently keeps tests under `tests/`, while the generated 0.9.0 configuration targets `src/**/*.{test,spec}.{ts,tsx}`.
