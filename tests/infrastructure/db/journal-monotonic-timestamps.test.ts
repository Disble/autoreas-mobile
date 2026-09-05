import journal from "../../../src/infrastructure/db/migrations/meta/_journal.json";
import { MIGRATION_0010_TIMESTAMP_MS } from "../../../src/infrastructure/db/client/client.constants";

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
   * 0011's `when` must clear the clamp target or `clampPoisonedMigrationTimestamp` un-poisons it
   * right back down before it ever gets to run (see design.md Decision 5). The constant itself
   * must stay put -- deriving or bumping it to the newest migration would poison THAT one next.
   */
  it("keeps entry 0011 strictly after MIGRATION_0010_TIMESTAMP_MS", () => {
    const entry11 = journal.entries.find((entry) => entry.tag.startsWith("0011_"));

    expect(entry11).toBeDefined();
    expect(entry11?.when).toBeGreaterThan(MIGRATION_0010_TIMESTAMP_MS);
    expect(MIGRATION_0010_TIMESTAMP_MS).toBe(1788546067501);
  });
});
