# Postmortem: the EAS build container rewrote the host's Git hooks

- **Date:** 2026-08-08
- **Status:** Resolved — fix verified against a real container build
- **Severity:** Near miss. No confirmed gate bypass; the failure mode that would have caused one was latent and reachable.
- **Commits:** `1f019c8`
- **Related:** `ARCHITECTURE.md` → *Hook installation is host-owned*; `AGENTS.md` rule 14; `CLAUDE.md` rule 11

## Summary

Running the local EAS Android build regenerated the **host machine's** `.git/hooks/`
from inside a Linux container. The hooks were rewritten with container-local binary
paths that do not exist on the Windows host.

The pre-commit gate kept working anyway, because the generated hook falls back
through roughly a dozen candidate lefthook locations and eventually reached
`node_modules/lefthook/bin/index.js`. So this is a near miss, not an outage.

It is worth a postmortem regardless, because the final fallback branch in that
generated script is:

```sh
echo "Can't find lefthook in PATH"
```

which **exits 0**. Had the fallback chain broken for any reason, every gate —
lint, typecheck, the 623-test suite, the staged mutation guard — would have
stopped running while `git commit` continued to report success. Nothing in the
repository would have detected that.

## Impact

| | |
|---|---|
| Confirmed gate bypass | None found |
| Host hooks modified by a container | Yes — confirmed by Linux paths in `pre-commit` |
| Version drift introduced | Hook executed lefthook 2.1.4; host CLI reported 2.1.5 |
| Duration | Unknown. The hook file is untracked, so there is no history to date it. |
| Blast radius if the fallback had failed | Total, silent: all pre-commit gates stop, exit code stays 0 |

The duration being unknown is itself a finding: `.git/hooks/` is not version
controlled, so nothing can say when the file changed or how many commits were
made against a degraded gate.

## Timeline

| When | What |
|---|---|
| Unknown | A local EAS Docker build runs `bun install`, which triggers `prepare: lefthook install` inside the container. The bind-mounted `.git` means the host's hooks are rewritten with Linux paths. |
| 2026-08-08 | A report arrives that "the lefthook configuration isn't working." |
| 2026-08-08 | Inspection finds `pre-commit` referencing `/tmp/root/eas-build-local-nodejs/.../lefthook-linux-x64/bin/lefthook`, while `prepare-commit-msg` references `lefthook.exe` — two hooks generated on two different platforms. |
| 2026-08-08 | The gate is executed directly and passes (exit 0), then fails correctly (exit 1) on a real lint error. The configuration is proven healthy; the generated script is the problem. |
| 2026-08-08 | Root cause identified: `- .:/app` bind-mounts `.git`, and `.dockerignore` does not apply to runtime mounts. |
| 2026-08-08 | Two candidate fixes proposed and empirically **refuted** (see below). |
| 2026-08-08 | Three-part fix landed in `1f019c8`. Host hooks repaired with `npx lefthook install`. |
| 2026-08-08 | A full `docker compose -f docker-compose.eas.yml run --rm eas-build` completes. Hooks verified untouched: `lefthook.exe` only, no container path in any hook, clean `git status`. |

## Root cause

Three independent facts combined:

1. `docker-compose.eas.yml` mounts the project with `- .:/app`. A bind mount is
   not filtered by `.dockerignore`, so the container's `/app/.git` **is** the
   host's `.git`.
2. `package.json` contained `"prepare": "lefthook install"`. The `prepare`
   lifecycle script runs on every `bun install`, including the container's.
3. The `lefthook install` **command ignores the `CI` environment variable**.
   Only lefthook's own npm `postinstall` honours it.

Fact 3 is the non-obvious one. Setting `CI=true` alone would not have helped
while the explicit `prepare` script existed, because that script bypasses the
guard entirely by invoking the binary directly.

## Contributing factors

**`.dockerignore` looked like protection.** It lists `.git` on line 9. That line
only filters the `docker build` context and has no effect on a runtime bind
mount. Anyone auditing this file would reasonably conclude `.git` was excluded.

**The artifact is untracked.** `.git/hooks/pre-commit` cannot be reviewed,
diffed, or protected by any gate, because it lives inside `.git` itself. The
thing that enforces our quality bar is the one thing our quality bar cannot see.

**The failure mode is silent by design.** Lefthook's generated script ends in
`echo` + implicit exit 0 rather than a non-zero exit. That is a defensible
default for a hook manager — it avoids blocking commits on a broken install —
but it converts "gate is broken" into "gate passed."

**Fixing it correctly required knowing Bun-specific behaviour.** See below.

## What went wrong in the investigation

Two proposed fixes were confidently wrong, and both were caught only by running
them. Recording these because they are the cheapest part of this document to
re-derive incorrectly.

### Wrong fix 1 — `LEFTHOOK=0`

Proposed because the generated hook script checks `LEFTHOOK=0` at line 8 and
exits early. Reasonable inference; incorrect. That variable gates hook
*execution*, not installation.

Test: append a marker to `pre-commit`, run `LEFTHOOK=0 npx lefthook install`,
check whether the marker survives. It did not — the installer ran anyway.

### Wrong fix 2 — deleting `prepare` on its own

Lefthook's npm package ships its own `postinstall` that installs hooks and
respects `CI`. The explicit `prepare` script therefore looked purely redundant,
and removing it looked like a clean simplification that also fixed the bug.

Test: delete `.git/hooks/pre-commit`, run `bun install --frozen-lockfile`, check
whether the hook returns. It did not. **Bun blocks dependency lifecycle scripts
by default.** Without `trustedDependencies`, lefthook's `postinstall` never runs
and *nobody* gets hooks. The `prepare` script existed precisely to paper over
this.

That is the trap: the "simplification" silently disables hook installation
everywhere, producing exactly the class of failure this postmortem is about.

## The fix, and why it is three parts

All three settings are load-bearing. Removing any one breaks the gate in a
different direction, which is why they are documented as a single invariant in
four places rather than as three independent settings.

| Setting | File | Remove it and… |
|---|---|---|
| `CI=true` | `docker-compose.eas.yml` | the container rewrites the host's hooks again |
| no `prepare` script | `package.json` | `CI` is bypassed, and the container rewrites hooks again |
| `trustedDependencies: ["lefthook"]` | `package.json` | Bun blocks the postinstall and **no hooks install at all** |

Verified both directions on Bun 1.3.14: `bun install` installs hooks;
`CI=true bun install` does not. Then verified end to end against a real EAS
container build.

Note: `bun install` only installs hooks when it actually (re)installs packages.
A deleted hook on an otherwise-current tree is **not** restored by `bun install`.
Repair with `npx lefthook install` on the host.

## Detection gap

This was found because a human noticed something felt wrong, not because
anything reported it. There is currently no check that answers:

> Are the hooks on this machine the ones this repository expects?

That check is cheap — compare the resolved lefthook binary against the platform,
or assert `npx lefthook version` matches `package.json`. It does not exist yet.

## Action items

| # | Action | Status |
|---|---|---|
| 1 | Set `CI=true` in the EAS container environment | Done — `1f019c8` |
| 2 | Remove `prepare: lefthook install` from `package.json` | Done — `1f019c8` |
| 3 | Add `trustedDependencies: ["lefthook"]` | Done — `1f019c8` |
| 4 | Repair the clobbered hooks on the host | Done — `npx lefthook install` |
| 5 | Document as one invariant in README, ARCHITECTURE, AGENTS, CLAUDE | Done — `1f019c8` |
| 6 | Verify against a real container build | Done — hooks untouched, `git status` clean |
| 7 | Add a hook-health check that fails loudly when the installed hook does not match the platform or the pinned version | **Open** |
| 8 | Consider excluding `.git` from the container mount (`EAS_NO_VCS=1`) as defence in depth against any container tool touching repo state | **Open** — needs one more build to validate |

Items 7 and 8 are the only ones that change the outcome if this recurs through a
different tool. Items 1–6 fix lefthook specifically.

## Lessons

- `.dockerignore` does not apply to bind mounts. A runtime mount shares
  everything, including `.git`.
- A gate that fails open is worse than a gate that fails closed, because the
  failure is indistinguishable from success.
- Anything inside `.git/` is invisible to review and to every gate in the repo.
- When a fix is reasoned rather than executed, it is a hypothesis. Two out of two
  reasoned fixes here were wrong.

## Appendix: separate, still-open bug

The same session addressed an unrelated report — chapter `+`/`−` buttons
intermittently doing nothing. That work landed as instrumentation in `1f019c8`
and `56c449e`; **its root cause is still unknown** and it is not covered by this
postmortem. Three ranked hypotheses and the field-diagnosis procedure are
recorded in the commit messages and in the agent memory entry
`dead-chapter-buttons-investigation`.

The two share a theme worth naming: both were failures that reported success.
One hid a broken button behind an unhandled promise rejection; the other hid a
degraded gate behind `exit 0`.
