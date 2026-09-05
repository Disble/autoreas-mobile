import { ReconcileResponseSchema } from '../../../src/features/sync/reconcile.schema';

/** Builds a fixture English bridge wire anime snapshot, including the required OCC token. */
function makeWireSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'anime-1',
    name: 'Naruto',
    status: 1,
    episodesWatched: 12,
    totalEpisodes: 220,
    days: [],
    genres: [],
    kind: 1,
    active: 1,
    firstCycle: 0,
    lastWatchedAt: 1710000000000,
    premieredAt: null,
    createdAt: null,
    deletedAt: null,
    cover: null,
    sourceUrl: null,
    folder: null,
    studios: null,
    origin: null,
    durationMinutes: null,
    modified_at: 0,
    ...overrides,
  };
}

describe('ReconcileResponseSchema conflict honesty', () => {
  it('acepta snapshots y changed_fields en inglés con timestamps numéricos', () => {
    const parsed = ReconcileResponseSchema.safeParse({
      status: 'accepted',
      applied_operations: [],
      bridge_changes: [
        {
          record_id: 'anime-1',
          change_type: 'update',
          changed_fields: ['status', 'episodesWatched', 'lastWatchedAt'],
          snapshot: makeWireSnapshot(),
          timestamp: 1710000001000,
        },
      ],
      last_changelog_id: 10,
    });

    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Expected successful parse');
    }

    expect(parsed.data.bridge_changes[0]?.changed_fields).toEqual([
      'status',
      'episodesWatched',
      'lastWatchedAt',
    ]);
    expect(parsed.data.bridge_changes[0]?.snapshot?.lastWatchedAt).toBe(1710000000000);
  });

  it('tolera changed_fields desconocidos sin vaciar bridge_changes', () => {
    const parsed = ReconcileResponseSchema.safeParse({
      status: 'accepted',
      applied_operations: [],
      bridge_changes: [
        {
          record_id: 'anime-1',
          change_type: 'update',
          changed_fields: ['status', 'unsupportedField'],
          snapshot: makeWireSnapshot({ totalEpisodes: undefined, kind: undefined, lastWatchedAt: undefined }),
          timestamp: 1710000001000,
        },
      ],
    });

    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Expected successful parse');
    }

    expect(parsed.data.bridge_changes).toHaveLength(1);
    expect(parsed.data.bridge_changes[0]?.changed_fields).toEqual(['status', 'unsupportedField']);
  });

  it('rechaza snapshots wire inválidos y no los convierte silenciosamente en []', () => {
    const parsed = ReconcileResponseSchema.safeParse({
      status: 'accepted',
      applied_operations: [],
      bridge_changes: [
        {
          record_id: 'anime-1',
          change_type: 'update',
          changed_fields: ['status'],
          snapshot: makeWireSnapshot({ episodesWatched: '12' }),
          timestamp: 1710000001000,
        },
      ],
      last_changelog_id: 10,
    });

    expect(parsed.success).toBe(false);
  });

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

  it('parses a confirmed applied_operations modified_at of 0 to exactly 0, not undefined', () => {
    const parsed = ReconcileResponseSchema.safeParse({
      status: 'accepted',
      applied_operations: [{ anime_id: 'anime-1', operation: 'update', applied: true, modified_at: 0 }],
      bridge_changes: [],
    });

    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Expected successful parse');
    }

    expect(parsed.data.applied_operations[0]?.modified_at).toBe(0);
  });

  it('parses an absent applied_operations modified_at as undefined, distinguishable from a parsed 0', () => {
    const parsed = ReconcileResponseSchema.safeParse({
      status: 'accepted',
      applied_operations: [{ anime_id: 'anime-1', operation: 'update', applied: true }],
      bridge_changes: [],
    });

    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Expected successful parse');
    }

    expect(parsed.data.applied_operations[0]?.modified_at).toBeUndefined();
  });

  it('rejects a bridge_changes snapshot missing modified_at (WireAnimeSchema is shared, required is coupled)', () => {
    const snapshot = makeWireSnapshot() as Record<string, unknown>;
    delete snapshot.modified_at;

    const parsed = ReconcileResponseSchema.safeParse({
      status: 'accepted',
      applied_operations: [],
      bridge_changes: [
        {
          record_id: 'anime-1',
          change_type: 'update',
          changed_fields: ['status'],
          snapshot,
          timestamp: 1710000001000,
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });
});
