---
name: mutation-tdd
description: "Mutation checking as the MUTATE step of the TDD cycle for autoreas-mobile. Use after a test goes green, when writing or reviewing any test that guards a conditional, a defensive branch, an error path, a lock, or an async race, and whenever a test looks rigorous but you have not proven it fails. Answers 'does this test actually assert anything?'. Keywords: mutation testing, mutation, kill the mutant, survived, TDD, red green refactor, does the test fail, vacuous test, guard deleted, stryker, dlinter, coverage lie, jest."
metadata:
  author: autoreas-mobile
  version: "1.0.0"
  scope: project
  updates: living
---

# Mutation Checking in the TDD Cycle

**A test that cannot fail is not a test.** This skill makes that check a step you
perform, not a tool you run.

## Why you carry this, not the hook

`lefthook.yml` runs `test:mutation:staged` on every commit, so it looks like the
gate already does this. Read `scripts/dlinter-mutation-staged.mjs`:

```js
const mutationSurface = `${prefix}src/features/sync/native-foreground-sync-ticker.helpers.ts`;
const staged = output.split(/\r?\n/).filter((file) => file === mutationSurface);
if (staged.length === 0) { /* ...prints, and */ process.exit(0); }
```

**One file.** Stage a change anywhere else and the guard exits 0 with a green
tick. The cause is structural: dlinter drives Stryker through **Vitest**, this
project's suite is **Jest + `jest-expo`**, and the two cannot share a suite — so
mutation lives on a tiny isolated Vitest island (`tests/mutation/`). See
`docs/mutation-testing.md`.

Everything else — every hook, every helper touching React Native, `expo-sqlite`,
or the bridge client — is covered by **you doing the check below**, or by nothing
at all.

## The cycle

RED → GREEN → **MUTATE** → REFACTOR.

The new step sits after green and before refactor, because refactoring behind a
test that asserts nothing is how a regression ships.

## The check

For every guard your test claims to cover:

1. **Delete the guard** in the production file — the whole `if` body, the early
   `return`, the clamp, the `??` fallback, the `catch`.
2. **Run only that test.**
3. **It must fail.** If it passes, the mutant survived: the test proves nothing.
4. **Restore the file** — `git checkout -- <file>` is the safe restore.

```sh
# 1-2. break it, run the one test file (fast: single files run in ~1s)
bunx jest tests/features/sync/sync-cycle-lock.helpers.test.ts

# narrow to a single case when the file is large
bunx jest tests/features/sync/sync-cycle-lock.helpers.test.ts -t "reclaims an expired lock"

# 4. always restore from git, never by hand-retyping
git checkout -- src/features/sync/sync-cycle-lock.helpers.ts
```

Do not use `bun run test` for this — it is `jest --runInBand` over the whole
suite and you will wait for hundreds of irrelevant tests to learn one fact.

Do this for **each** guard separately. A test that dies when any of three guards
is removed has told you nothing about which one it covers.

## When it is mandatory

Do not skip the check for:

- **Any test with async races or locks** — `sync-cycle-lock`, the reconcile
  drain, the foreground/background sync handoff. Highest-risk category here.
- **Defensive branches** — nil/undefined guards, clamps, `??` fallbacks,
  `if (!x) return`.
- **Error paths, `catch` blocks, and timeout branches.**
- **Anything crossing the bridge boundary** (`src/infrastructure/api`) — error
  taxonomy branches are exactly the code no happy-path test touches.
- **Any test you wrote to close a coverage gap** — coverage proves execution,
  never assertion.

## Traps that make a mobile test silently vacuous

### The mock that satisfies both branches

`expect(mock).toHaveBeenCalled()` passes whether the guard ran or not when the
mocked seam is invoked on both sides of the branch. Assert on **arguments or
call count**, or on the returned value, not on the bare fact of a call.

A jest mock with no `mockResolvedValue` returns `undefined`. `await undefined` is
`undefined`, so a test can await a function that never ran the code you think it
did and still go green.

### Awaiting a promise that always resolves

Async guards need a **deterministic** trigger. Do not write a stress loop and
assume it reached the raced state. If a branch is unreachable through the public
API, **call the unexported helper directly** from the test and reproduce the
state — the pure `*.helpers.ts` files exist precisely so this is possible without
the Expo bootstrap.

### Timers

When a test targets a timeout or interval branch, drive it with explicit fake
timers so the deadline you are testing provably fires first. A real-clock race
between two deadlines means the branch under test may never be evaluated, and
the test still passes.

### Trusting the green tick

The origin project of this skill (`autoreas-bridge`) caught **two passing tests
that asserted nothing** this way. Neither the test runner nor the coverage
percentage flagged them. The only signal was deleting the guard.

## Verify with coverage first

Cheaper than mutating, and it catches the "never executed" case:

```sh
bun run test:coverage        # jest --coverage, writes coverage/
```

Open `coverage/lcov-report/index.html` and find your file. A branch at `0`
executions cannot possibly be asserted — fix that before mutating. But **do not
stop there**: covered and asserted are different things, and the gap between them
is exactly what this skill exists for.

## Equivalent mutants: when survival is correct

Some mutants survive because removing the code changes no observable behaviour.
Killing them is impossible and writing a test that tries is waste. Three are
documented in `docs/mutation-testing.md` for the sync ticker — optional chaining
on a contract that always returns a value, a `null` return where the caller
treats `null` and `undefined` identically.

If you cannot state the observable difference the guard makes, it may be
equivalent. Say so and move on; do not fake an assertion to make a number go up.

## When to reach for the tooling instead

Only for the one gated file, or when expanding the mutation surface:

```sh
bunx vitest run --config vitest.dlinter-mutation.mts
bunx stryker run stryker.dlinter.json
bun run test:mutation:staged
```

Read `docs/mutation-testing.md` before touching any of it — the surface is a
single hardcoded path in three separate places, and widening it requires a pure
helper that runs without `jest-expo`.

## Reporting

When you have mutation-checked something, say which guards you deleted and
whether each mutant was killed. "Tests pass" is not the claim; "the test fails
when the guard is removed" is.

Never report a test as covering a guard you did not break.
