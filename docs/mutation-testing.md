# Mutation Testing (autoreas-mobile)

Mutation checking answers the one question a coverage number cannot: *if this
code were broken, would any test notice?*

This document is the reference for **what the tooling actually covers here**.
The step you perform by hand is in `.claude/skills/mutation-tdd/SKILL.md` — read
that one when you are writing tests. Read this one when you want to know why the
automated guard is not enough.

## The automated guard covers exactly one file

`lefthook.yml` runs `test:mutation:staged` on every commit, so the gate looks
like project-wide mutation coverage. It is not.

`scripts/dlinter-mutation-staged.mjs` keeps only staged files that match a single
hardcoded path:

```js
const mutationSurface = `${prefix}src/features/sync/native-foreground-sync-ticker.helpers.ts`;
const staged = output.split(/\r?\n/).filter((file) => file === mutationSurface);

if (staged.length === 0) {
  console.log('dlinter mutation guard: no staged mutation-surface TypeScript lines.');
  process.exit(0);
}
```

Stage a change to any other production file and the guard prints that line and
**exits 0**. Every feature outside `native-foreground-sync-ticker.helpers.ts`
has zero automated mutation coverage while the pre-commit gate reports green.

That green tick is the reason the manual `MUTATE` step is mandatory here rather
than advisory.

## Why the surface is that narrow

`dlinter-ts-react` 0.9.0 drives mutation through Stryker's **Vitest** runner, but
this project's primary suite is **Jest + `jest-expo`** (`jest.config.js`,
`roots: ['<rootDir>/tests']`). The two runners cannot share a suite, so the
mutation surface is a separate, deliberately tiny Vitest island:

| Piece | Path | Scope |
| --- | --- | --- |
| Stryker config | `stryker.dlinter.json` | `mutate` pinned to one file; `break: 80` |
| Vitest config | `vitest.dlinter-mutation.mts` | `include: ['tests/mutation/**/*.mutation.test.ts']` |
| Mutation suite | `tests/mutation/native-foreground-sync-ticker.mutation.test.ts` | the only file in it |
| Staged guard | `scripts/dlinter-mutation-staged.mjs` | pre-commit, single-path filter |

Full background, the CLI evidence, and the reproduction are in
`docs/dlinter-incremental-mutation-blockers.md`. Do not duplicate that content
here; it is the bug-report record, this is the workflow contract.

## Running it manually

```sh
bunx vitest run --config vitest.dlinter-mutation.mts   # the mutation suite alone
bunx stryker run stryker.dlinter.json                  # the full bounded run
bun run test:mutation:staged                           # what pre-commit runs
```

Last recorded bounded run: **30 of 37 mutants killed, 81.08%**, against the
generated `break: 80` threshold. That is a two-mutant margin — a single new
surviving mutant in that helper fails the commit.

The staged guard is better behaved than a naive full run: it scopes Stryker to
the **changed line ranges** from `git diff --cached --unified=0` and reuses an
incremental cache at `<git-dir>/dlinter/stryker-staged.json`. It also **refuses
partial staging** — a file with unstaged changes on top of staged ones throws,
because mutation would otherwise judge a tree state that is not what gets
committed.

## Known equivalent mutants in the sync ticker

These three survive and are *correct* to survive. Do not write a test to kill
them; an equivalent mutant has no observable behaviour to assert.

- The default `expo-modules-core` lazy loader never executes — the mutation tests
  inject the native-module lookup seam.
- Removing the `null` return from the optional-module loader's `catch` is
  externally equivalent: the downstream ticker treats `null` and `undefined`
  as unavailable.
- Removing optional chaining from `subscription?.remove()` is equivalent while
  the declared native-module contract always returns a subscription from
  `addListener`.

## Expanding the surface

Adding a file to `stryker.dlinter.json`'s `mutate` requires a matching isolated
Vitest test in `tests/mutation/`, and the target must be a **pure helper that
runs without the Expo/Jest bootstrap**. Prove it first:

```sh
bunx vitest run --config vitest.dlinter-mutation.mts
bunx stryker run stryker.dlinter.json --dryRunOnly
```

Then widen `mutationSurface` in `scripts/dlinter-mutation-staged.mjs` — it is a
single-path equality check today and must become a set before a second file is
ever gated. Do not broaden the staged hook before its runtime cost is measured.

Everything that cannot meet that bar — hooks, anything touching React Native or
`expo-sqlite`, anything needing `jest-expo` — is covered by the manual check, not
by Stryker.
