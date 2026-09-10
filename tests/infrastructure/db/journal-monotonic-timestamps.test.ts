import journal from "../../../src/infrastructure/db/migrations/meta/_journal.json";
import {
  MAX_JOURNAL_MIGRATION_TIMESTAMP_MS,
  MIGRATION_JOURNAL_TIMESTAMPS_MS,
} from "../../../src/infrastructure/db/client/client.constants";

/**
 * H0Xx root cause: entry idx 6 (0006) carried a hand-typed future `when` (2026-09-20) that was
 * both sixteen days ahead of every other entry AND the maximum of the whole journal. Drizzle's
 * migrator gates every migration on a single scalar comparison against the highest `created_at`
 * already stored, so that one out-of-order value silently skipped every migration after it on any
 * device that had already applied 0006. This guard fails the moment anyone hand-edits a `when`
 * value out of `idx` order again.
 */
describe("migration journal timestamp order", () => {
  it("keeps every entry's when strictly increasing with its idx", () => {
    const whens = journal.entries.map((entry) => entry.when);

    for (let index = 1; index < whens.length; index += 1) {
      expect(whens[index]).toBeGreaterThan(whens[index - 1]);
    }
  });

  it("keeps entry 0006 immediately after 0005, not sixteen days into the future", () => {
    const entry5 = journal.entries.find((entry) => entry.tag.startsWith("0005_"));
    const entry6 = journal.entries.find((entry) => entry.tag.startsWith("0006_"));

    expect(entry5).toBeDefined();
    expect(entry6).toBeDefined();
    expect(entry6?.when).toBe((entry5?.when ?? 0) + 1);
  });

  /**
   * The ledger repair identifies a stored row by its ordinal position, so the derived timestamp
   * list must stay a faithful, journal-ordered copy. A drifted copy would rewrite rows to the
   * wrong migration's `when` and hand the migrator a gate that re-runs work already applied.
   */
  it("mirrors every journal entry in idx order", () => {
    expect(MIGRATION_JOURNAL_TIMESTAMPS_MS).toEqual(
      [...journal.entries].sort((left, right) => left.idx - right.idx).map((entry) => entry.when),
    );
  });

  /**
   * The clamp ceiling must be the journal MAXIMUM, never a fixed older migration's `when`. A
   * ceiling below the newest entry drags every legitimately applied row above it backwards, and
   * the migrator then re-runs those migrations into a `duplicate column name` startup brick.
   */
  it("keeps the poison ceiling at or above every entry's when", () => {
    for (const entry of journal.entries) {
      expect(entry.when).toBeLessThanOrEqual(MAX_JOURNAL_MIGRATION_TIMESTAMP_MS);
    }

    expect(MAX_JOURNAL_MIGRATION_TIMESTAMP_MS).toBe(
      Math.max(...journal.entries.map((entry) => entry.when)),
    );
  });
});
