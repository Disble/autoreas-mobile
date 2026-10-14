# Episode durations and long-episode mark

Objective: carry the bridge's per-episode durations (`MobileAnime.episodes`) end-to-end and show the "long next episode" mark on the anime card, offline-first.
Branch: `feat/episode-durations` (from `main` @ b8da9ad) · Delivery: `ask-on-risk` · Runner: `bun run test` (Jest), `bun run test:kotlin` (native), gate `npx lefthook run pre-commit`.

## Specs

- **S1 — Wire field.** Accept the bridge contract verbatim:
  `"episodes": [ { "episode": 1, "minutes": 24, "long": false }, { "episode": 2, "minutes": 46, "long": true } ]`
  "`EpisodeLength`: `episode` int ≥ 1 · `minutes` int ≥ 0 (runtime guardado, redondeado al minuto) · `long` bool. Todos requeridos."
  It arrives in "`GET /api/animes`, `GET /api/animes/{id}` y cada `AnimeChange.snapshot`". Mobile consumes `GET /api/animes` (initial sync and foreground resync) and `bridge_changes[].snapshot` of `POST /api/sync/reconcile`, both JS (foreground) and Kotlin (native background engine).
- **S2 — Replace, never merge.** "Campo AUSENTE = "sin duraciones". Reemplacen su copia entera, no hagan merge." A change with `changed_fields: ["episodes"]` and no `episodes` key clears the local copy.
- **S3 — Durations-only updates are applied.** "Un cambio que solo tocó duraciones llega como `update` normal con `changed_fields: ["episodes"]`": `episodes` must survive `changed_fields` normalization in TS and Kotlin and be written through the partial-update merge path.
- **S4 — Offline persistence.** Durations are stored on the `animes` row (new nullable JSON text column `episodes`), so the mark shows without a connection. The migration ships with its idempotent repair twin and readiness bump (TS and Kotlin).
- **S5 — Backfill.** Animes already synced before the upgrade receive their durations without a bridge-side change, through the existing foreground resync (`resyncFromBridgeSnapshot`).
- **S6 — Mark rule.** "Marca de Today: la entrada con `episode == episodesWatched + 1` y `long: true`. Si `episodesWatched` es fraccionario, no hay siguiente episodio y no hay marca." Mobile computes nothing else: `long` is bridge-decided ("puede venir `minutes: 30` con `long: true`").
- **S7 — Card chip.** The card shows the mark as a chip mirroring the desktop: "Ep. 7 · 45 min". *Assumption: placement and copy mirror the desktop chip; the user approved the plan without specifying the design.*
- **S8 — Canonical storage form.** TS and Kotlin produce byte-identical serialized `episodes` (entry keys `episode, minutes, long`; `null` for absent) so `deriveChangedFields` does not rewrite rows on every resync. *Decision: a malformed `episodes` value is treated as absent (`null`) instead of failing the whole sync response.*

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S4 | inline | pending | — |
| T2 | S1, S2, S3, S5, S8 (TS) | inline | pending | — |
| T3 | S1, S3, S8 (Kotlin) | inline | pending | — |
| T4 | S6, S7 | inline | pending | — |
| T5 | all | delegated verifier (Risk: item 1 migration, item 3 shared wire contract) | pending | — |

Route evidence: no Writer trigger (no parallel units launched together, no context backstop) — the parent writes inline.

## Log

- **L1 (2026-10-14, user, verbatim):** "Te lo apruebo como ODD" — approving: "Columna `episodes` con su migración y su paso de reparación. Traducción del campo desde el formato de Bridge. Regla de la marca. Resincronización completa al actualizar, para que lleguen las duraciones de los animes que no cambien. Mostrar la marca en la tarjeta."
- **L2 (2026-10-14):** Contract source: bridge `docs/openapi.yaml` on `feat/episode-durations` @ f436964d. Bridge owns the changelog invariant (current snapshot read in the insert tx; ts = max(now, last+1); no non-delete row for a missing anime) that protects already-installed mobile builds; mobile needs no change for it.
- **L3 (2026-10-14):** Mapping found the Kotlin `ReconcileResponseParser` lists snapshot fields explicitly (`LOCAL_FIELD_BY_WIRE_FIELD`, `mapToLegacy`) — without T3, background-staged changes would drop `episodes`. No upgrade-time resync is needed: `useForegroundResync` runs `resyncFromBridgeSnapshot` on mount and on foreground, which fills the new column via `deriveChangedFields` (S5 covered by T2).
- **Next:** T1.
