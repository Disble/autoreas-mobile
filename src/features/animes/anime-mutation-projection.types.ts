import type { Anime } from "../../infrastructure/validation/anime-schema";

/**
 * The local anime fields one accepted intent projects.
 *
 * Deliberately a pair and not the whole row: a chapter gesture also moves
 * `fechaUltCapVisto` and may touch `primeravez`, and none of those are drawn while the
 * write is pending, so projecting them would claim more than the card shows.
 */
export interface AnimeMutationProjectionFields {
  readonly nrocapvisto: number;
  readonly estado: number;
}

/**
 * One accepted chapter gesture waiting for its own ordered local write to become the
 * durable row.
 */
export interface AnimeMutationProjectionEntry {
  /** Identifies the entry, so the write that owns it can drop it when it fails. */
  readonly id: number;
  /** The values it was computed from: the intent stops applying once those move. */
  readonly base: AnimeMutationProjectionFields;
  /** The values the card shows while the intent is still newer than the durable row. */
  readonly projected: AnimeMutationProjectionFields;
}

/**
 * One anime's last durable snapshot plus the intents accepted on top of it, in
 * acceptance order. The durable row stays authoritative; the entries are an overlay on it.
 */
export interface AnimeMutationProjectionRecord {
  /** The last durable row read for this anime, and the base each new intent is built from. */
  readonly durable: Anime | null;
  readonly entries: readonly AnimeMutationProjectionEntry[];
}

/**
 * The whole transient projection, keyed by anime id. In memory only: it never reaches
 * SQLite, the outbox or the wire, and it is not a second durable log.
 */
export interface AnimeMutationProjectionState {
  readonly byAnimeId: Readonly<Record<string, AnimeMutationProjectionRecord>>;
}
