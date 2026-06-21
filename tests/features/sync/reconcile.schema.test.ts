import { ReconcileResponseSchema } from '../../../src/features/sync/reconcile.schema';

describe('ReconcileResponseSchema conflict honesty', () => {
  it('does not type or surface a conflicts field (dead scaffolding removed)', () => {
    const parsed = ReconcileResponseSchema.safeParse({
      status: 'accepted',
      applied_operations: [],
      bridge_changes: [],
      last_changelog_id: 10,
    });

    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Expected successful parse');
    }

    expect('conflicts' in parsed.data).toBe(false);
  });

  it('tolerates a bridge response that still sends a conflicts array without surfacing it as typed data', () => {
    const parsed = ReconcileResponseSchema.safeParse({
      status: 'accepted',
      applied_operations: [],
      bridge_changes: [],
      conflicts: [{ anime_id: 'anime-1', local: {}, remote: {} }],
      last_changelog_id: 10,
    });

    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Expected successful parse');
    }

    // Tolerant parse: the unknown `conflicts` field is silently stripped, never branched on.
    expect('conflicts' in parsed.data).toBe(false);
  });
});
