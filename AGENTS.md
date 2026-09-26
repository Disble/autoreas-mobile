# Project Agent Contract

This file is the canonical instruction set for repository agents. Prefer executable
configuration (`package.json`, `lefthook.yml`, ESLint, Jest, and CI) over prose when
they disagree. The codebase is the runtime truth; `openspec/` and `docs/specs/` are
historical evidence, not execution contracts.

## Before Editing

- Inspect the relevant code, tests, and configuration before proposing a change.
- Keep changes within the requested scope. Do not create features by hand; run
  `npm run generate:feature <name>`.
- Preserve ADRs, postmortems, changelog entries, learning logs, and historical
  OpenSpec artifacts unless the user explicitly requests otherwise.

## Local Android builds

- For device diagnosis, build a debuggable lab APK with
  `docker compose -f docker-compose.eas.yml run --rm eas-build lab`. Find the
  output under `dist/android/`; never distribute a lab APK.
- Upgrade an installed app with `adb install -r <path-to-lab-apk>` to preserve
  app data. If Android reports a signer mismatch, do not uninstall: uninstalling
  deletes local data. See [Local Android build](docs/local-android-build.md).
- This local build contacts Expo for EAS-managed signing credentials using
  `EXPO_TOKEN` from `.env.local`. Obtain explicit authorization for that remote
  operation before running it.

## Architecture Boundaries

- `.tsx` files are dumb UI: JSX, HeroUI Native primitives, and Tailwind classes via
  `cn()` only. Do not put business logic, `useEffect`, or database access there.
- Use HeroUI Native for new or refactored UI. Do not use raw React Native controls
  or `StyleSheet.create()` when Tailwind/Uniwind can express the result.
- Custom hooks follow this order: imports, signature, refs, state, context/third-party
  hooks, queries/mutations, derived state, callbacks, effects, return.
- Complex features use a public `index.ts`, dumb `.tsx` UI, `use-*.ts` logic, and
  separate `.types.ts`, `.constants.ts`, `.helpers.ts`, and optional `.schema.ts`.
  Do not define root-level types, constants, helpers, or schemas in `.tsx` or
  `use-*.ts` files.
- `src/app/**` composes routes only. It must not use custom hooks, React state/effect
  hooks, infrastructure imports, or business logic.
- `*Props` members in `*.types.ts` are `readonly`; feature UI and hooks export their
  main symbol as a named function.
- Keep every file at or below 500 lines. Use `src/features/animes` as the structural
  reference when no closer feature exists.
- All bridge HTTP and WebSocket traffic goes through `BridgeClient` in
  `src/infrastructure/api`; features must not call `fetch`, instantiate `WebSocket`,
  or build bridge URLs.

## Tests and Validation

- Tests live under `tests/`, mirroring the feature path. Jest does not collect tests
  from `src/`.
- Before changing a helper or hook, update or create its corresponding test. Follow
  RED → GREEN → MUTATE → REFACTOR.
- For mutation checks, stage the green implementation, delete the guarded behavior,
  run the focused test and confirm failure, then use `git checkout -- <file>` to
  restore from the index. Do not use `git checkout HEAD -- <file>` or restore from
  `HEAD` while the implementation is uncommitted.
- Every exported function and variable needs JSDoc. ESLint checks the complete staged
  file, so resolve its existing findings only in files touched by the change; do not
  run a repository-wide documentation cleanup.
- After React changes, run `npx -y react-doctor@latest . --verbose --diff` and resolve
  its findings.
- The real local gate is `npx lefthook run pre-commit`. Do not bypass it. Keep
  `trustedDependencies: ["lefthook"]`, omit a `prepare` script that installs Lefthook,
  and retain `CI=true` in `docker-compose.eas.yml`.

## Delegation and Verification

- Delegated implementation and bugfix work includes reproduction steps when known,
  happy-path and rejection examples, and prohibited behavior where relevant.
- The orchestrating agent performs final verification. Report every skipped, failed,
  and passing check.
