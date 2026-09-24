# Logbooks

A logbook is an **append-only record of measurements** that a later change is compared against. It
answers "what did this cost last time, measured the same way?" — the question that caught a
4.5-minute build silently turning into a 14.5-minute one on 2026-09-23.

| Logbook | Records |
| --- | --- |
| [Build performance](build-performance.md) | Wall time, Gradle work, cache reuse and resources of the local Docker build and the CI release |

## How a logbook differs from the other records

| Record | Holds | Lifetime |
| --- | --- | --- |
| Logbook (`docs/logbooks/`) | Measured numbers, one row per measurement, with the method to reproduce them | Permanent, only appended to |
| ODD feature document (`odd/tasks/`) | Why one piece of work was done, its decisions and tasks | Closes with the work |
| Learning log (`docs/learning-log.md`) | One-sentence lessons | Permanent |
| Postmortem (`docs/postmortems/`) | One incident, analysed | Permanent |

## Rules

- **Append, never rewrite.** A wrong row is corrected by a new row that says so.
- **Every row names its method.** A number measured differently from the rows above it is not
  comparable; say so in the row or do not add it.
- **Every row names what it measured:** date, commit, configuration. A number without its commit
  cannot be reproduced.
- **Say what one sample cannot tell.** A single build is not a trend; mark noise when two runs of
  the same configuration disagree.
