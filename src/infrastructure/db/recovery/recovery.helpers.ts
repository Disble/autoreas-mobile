import { RESET_TARGET_DATABASE_NAME } from './recovery.constants';
import { ResetIntentSchema, type ResetIntent } from './recovery.schema';
import type {
  DatabaseResetOrchestrator,
  DatabaseResetOutcome,
  DatabaseResetPorts,
  ResetDecision,
  ResetDecisionInput,
} from './recovery.types';

/**
 * Answers whether a startup diagnostic authorizes destroying the application database.
 *
 * The answer is `reset` for confirmed physical corruption and nothing else: `classification ===
 * 'corruption'`, which the startup diagnostic emits when SQLite's own `quick_check` rejected the
 * file. Every other classification refuses with that exact reason, and there is no parameter that
 * can override a refusal into a reset -- the function reads exactly one field and ignores
 * anything else a caller attaches.
 *
 * Correction (parent review): the Bridge and the stored configuration are NOT prerequisites. A
 * confirmed-corrupt device must be resettable with the Bridge offline or with no configuration at
 * all; pairing and snapshot happen AFTER the reset, so gating on them would strand exactly the
 * user this recovery exists for. Extra runtime fields are ignored, never consulted.
 */
export function decideDatabaseReset(input: ResetDecisionInput): ResetDecision {
  if (input.classification !== 'corruption') {
    return { outcome: 'refuse', reason: input.classification };
  }

  return { outcome: 'reset', reason: 'confirmed_corruption' };
}

/**
 * Reads a persisted reset intent, treating anything the schema rejects as absent.
 *
 * The persisted value is untrusted input: it may be a foreign record, a half-written payload, or a
 * value the storage layer returned in an unexpected shape. A rejected parse returns `null`, which
 * is identical to "no intent", so the caller re-authorizes from the current diagnostic instead of
 * trusting a payload it could not validate.
 */
export function parseResetIntent(raw: unknown): ResetIntent | null {
  const parsed = ResetIntentSchema.safeParse(raw);

  return parsed.success ? parsed.data : null;
}

/**
 * Creates the resumable, idempotent reset orchestrator over injected ports.
 *
 * Ordering is the contract: stop native writers, close every connection, then delete through the
 * API, then reopen and prepare, and only then clear the durable intent. The intent is written
 * BEFORE any destructive step, so process death anywhere in the destructive window leaves durable
 * evidence that the next launch resumes instead of diagnosing a half-deleted database. The intent
 * is cleared ONLY after `openAndPrepare` resolves successfully: preparation is idempotent, so a
 * crash during preparation resumes into a second preparation with the intent still durable, and a
 * crash after deletion but before preparation is recovered by the file probe instead of a second
 * deletion. When the intent exists and the database is already absent, deletion is skipped and the
 * resumed run goes straight to preparation.
 *
 * The returned `run` collapses a second concurrent invocation onto the in-flight operation, which
 * is what makes a double press safe: two presses share one probe, one deletion and one
 * preparation, never two racing deletions.
 */
export function createDatabaseResetOrchestrator(
  ports: DatabaseResetPorts,
): DatabaseResetOrchestrator {
  let inFlight: Promise<DatabaseResetOutcome> | null = null;

  async function executeReset(input: ResetDecisionInput): Promise<DatabaseResetOutcome> {
    let rawIntent: unknown;

    try {
      rawIntent = await ports.readResetIntent();
    } catch {
      return { status: 'failed', stage: 'intent_read' };
    }

    // A validated intent is durable authorization from an earlier run. It is resumed as-is: the
    // current diagnostic describes a database that is already gone or half-deleted, so
    // re-deciding would either stall on a transient classification or re-authorize destruction
    // the previous run already committed to. A malformed or foreign payload parses to null and
    // therefore falls through to a fresh decision.
    const isResuming = parseResetIntent(rawIntent) !== null;

    if (!isResuming) {
      const decision = decideDatabaseReset(input);

      if (decision.outcome === 'refuse') {
        // Nothing is written and nothing is stopped: a refusal cannot leave durable or destructive
        // traces behind.
        return { status: 'refused', reason: decision.reason };
      }

      try {
        await ports.writeResetIntent({ reason: decision.reason, requestedAt: ports.now() });
      } catch {
        // The intent is durable before destruction or it does not happen. A failed write means
        // this run stops with the database untouched.
        return { status: 'failed', stage: 'intent_write' };
      }
    }

    try {
      await ports.stopNativeWriters();
    } catch {
      return { status: 'failed', stage: 'stop_native_writers' };
    }

    try {
      await ports.closeDatabaseConnections();
    } catch {
      return { status: 'failed', stage: 'close_connections' };
    }

    let isDatabasePresent: boolean;

    try {
      isDatabasePresent = await ports.isDatabasePresent();
    } catch {
      return { status: 'failed', stage: 'database_probe' };
    }

    let deleted = false;

    if (isDatabasePresent) {
      try {
        await ports.deleteDatabase(RESET_TARGET_DATABASE_NAME);
        deleted = true;
      } catch {
        // The intent stays exactly as it was. The next launch resumes, probes again, and retries
        // the deletion rather than treating a failed delete as a completed reset.
        return { status: 'failed', stage: 'database_delete' };
      }
    }

    try {
      await ports.openAndPrepare();
    } catch {
      // The intent stays exactly as it was. Preparation is idempotent, so the next launch resumes
      // into a second preparation instead of diagnosing a database it may have already emptied;
      // clearing the intent here would erase the only durable evidence of the in-flight reset.
      return { status: 'failed', stage: 'database_prepare' };
    }

    try {
      await ports.clearResetIntent();
    } catch {
      // The destructive window and preparation both completed; only the bookkeeping failed. The
      // intent survives so the next launch resumes and clears it rather than re-diagnosing.
      return { status: 'failed', stage: 'intent_clear' };
    }

    return { status: 'completed', deleted };
  }

  return {
    run: (input) => {
      if (inFlight !== null) {
        return inFlight;
      }

      const operation = executeReset(input).finally(() => {
        inFlight = null;
      });

      inFlight = operation;

      return operation;
    },
  };
}
