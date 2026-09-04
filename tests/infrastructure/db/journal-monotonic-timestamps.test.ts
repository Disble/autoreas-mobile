import journal from "../../../src/infrastructure/db/migrations/meta/_journal.json";

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
});
