import { fetchMissingTokenOutcome } from '../../../src/features/sync/missing-token.helpers';
import { bridgeClient } from '../../../src/infrastructure/api';

jest.mock('../../../src/infrastructure/api', () => ({
  bridgeClient: { getAnime: jest.fn() },
}));

/** Mocks the bridge's single-anime fetch. */
const mockGetAnime = bridgeClient.getAnime as jest.Mock;

/** A paired bridge connection; every request through it is mocked. */
const CONNECTION = { ip: '192.168.0.10', port: 8080, token: 'token-1' };

/** A bridge HTTP result with the given status and payload. */
function httpResult(status: number, data: unknown = null) {
  return { ok: status >= 200 && status < 300, status, data, rawBody: null, url: 'u', retryAfterMs: null };
}

describe('fetchMissingTokenOutcome (ADR 009 R-3)', () => {
  it('returns the token the bridge sent, 0 included', async () => {
    mockGetAnime.mockResolvedValue(httpResult(200, { id: 'anime-1', modified_at: 0 }));

    await expect(fetchMissingTokenOutcome(CONNECTION, 'anime-1')).resolves.toEqual({ kind: 'token', token: 0 });
  });

  it('keeps the key pending on any status other than 200 and 404', async () => {
    mockGetAnime.mockResolvedValue(httpResult(500));

    await expect(fetchMissingTokenOutcome(CONNECTION, 'anime-1')).resolves.toEqual({ kind: 'unreachable' });
  });

  it('gives the key up when the token is not an integer', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGetAnime.mockResolvedValue(httpResult(200, { id: 'anime-1', modified_at: '42' }));

    await expect(fetchMissingTokenOutcome(CONNECTION, 'anime-1')).resolves.toEqual({
      kind: 'unresolved',
      reason: 'token_missing',
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('token_missing'), { animeId: 'anime-1' });
    warn.mockRestore();
  });

  it('gives the key up when the body is not an object at all', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGetAnime.mockResolvedValue(httpResult(200, null));

    await expect(fetchMissingTokenOutcome(CONNECTION, 'anime-1')).resolves.toMatchObject({ kind: 'unresolved' });
  });
});
