import { createBridgeClient } from '../../../src/infrastructure/api/bridge-client';
import {
  buildPostActiveSeasonRatingBody,
  extractActiveSeasonSnapshot,
} from '../../../src/infrastructure/api/bridge-client/bridge-url.helpers';

describe('extractActiveSeasonSnapshot', () => {
  it('maps the bridge `grade`/`grade_source` wire keys onto candidate snapshots', () => {
    const snapshot = extractActiveSeasonSnapshot({
      season_id: '2026-q3',
      candidates: [
        { anime_id: 'a1', grade: 5, grade_source: 'bridge' },
        { anime_id: 'a2', grade: null },
      ],
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.seasonId).toBe('2026-q3');
    expect(snapshot?.candidatesByAnimeId.a1).toEqual({
      animeId: 'a1',
      bridgeRating: 5,
      bridgeRatingSource: 'bridge',
    });
    expect(snapshot?.candidatesByAnimeId.a2).toEqual({
      animeId: 'a2',
      bridgeRating: null,
      bridgeRatingSource: null,
    });
  });

  it('drops candidates missing a usable anime_id', () => {
    const snapshot = extractActiveSeasonSnapshot({
      season_id: '2026-q3',
      candidates: [{ grade: 4, grade_source: 'bridge' }, { anime_id: '' }],
    });

    expect(snapshot?.candidates).toHaveLength(0);
  });
});

describe('buildPostActiveSeasonRatingBody', () => {
  it('serializes the rating onto the bridge `grade` wire key without rewriting ratedAt', () => {
    expect(
      buildPostActiveSeasonRatingBody({
        animeId: 'anime-9',
        nota: 4,
        ratedAt: 1_752_300_000_000,
      }),
    ).toEqual({
      anime_id: 'anime-9',
      grade: 4,
      rated_at: 1_752_300_000_000,
    });
  });
});

describe('postSyncDiagnostics', () => {
  const CONNECTION = { ip: '192.168.1.10', port: 9876, token: 'token123' };

  /** Builds a `fetch` double carrying only the members the bridge client reads. */
  function buildResponse(overrides: Partial<{ ok: boolean; status: number; body: string }> = {}) {
    const { ok = true, status = 200, body = '{}' } = overrides;

    return { ok, status, text: jest.fn(async () => body) };
  }

  it('sends bearer auth and a JSON body to the syncDiagnostics path', async () => {
    const fetchFn = jest.fn(
      async () => buildResponse({ status: 202, body: '{"status":"accepted"}' }) as unknown as Response,
    );
    const client = createBridgeClient({ fetchFn });
    const envelope = { cycle_id: 'cycle-1', degraded: null };

    const result = await client.postSyncDiagnostics(CONNECTION, envelope);

    expect(fetchFn).toHaveBeenCalledWith('http://192.168.1.10:9876/api/sync/diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token123' },
      body: JSON.stringify(envelope),
      signal: expect.any(AbortSignal),
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);
    expect(result.data).toEqual({ status: 'accepted' });
  });

  it('honors a timeoutMs override via BridgeRequestOptions', async () => {
    jest.useFakeTimers();
    const fetchFn = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    ) as unknown as typeof fetch;
    const client = createBridgeClient({ fetchFn });

    const pending = client.postSyncDiagnostics(CONNECTION, {}, { timeoutMs: 3_000 });
    const assertion = pending.catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(3_000);
    await assertion;

    jest.useRealTimers();
  });

  it('surfaces a non-2xx result without throwing', async () => {
    const fetchFn = jest.fn(
      async () =>
        buildResponse({ ok: false, status: 404, body: '{"error":"not_found"}' }) as unknown as Response,
    );
    const client = createBridgeClient({ fetchFn });

    const result = await client.postSyncDiagnostics(CONNECTION, { cycle_id: 'cycle-1' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.data).toEqual({ error: 'not_found' });
  });
});
