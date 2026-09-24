import { createBridgeClient } from '../../../src/infrastructure/api/bridge-client';
import { BRIDGE_COVER_REQUEST_TIMEOUT_MS } from '../../../src/infrastructure/api/bridge-client/bridge-client.constants';
import {
  buildAnimeCoverPath,
  classifyAnimeCoverResponse,
} from '../../../src/infrastructure/api/bridge-client/bridge-url.helpers';
import {
  BridgeTimeoutError,
  BridgeUnreachableError,
} from '../../../src/infrastructure/api/bridge-client/bridge-client.errors';

/** The paired bridge every case in this file talks to. */
const CONNECTION = { ip: '192.168.0.10', port: 8080, token: 'token-1' };

/** Builds a fetch double whose Response carries the given status, headers, and body bytes. */
function buildCoverResponse(overrides: {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly bodyBytes?: Uint8Array;
}) {
  const { status, headers = {}, bodyBytes } = overrides;

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    arrayBuffer: jest.fn(async () => {
      const bytes = bodyBytes ?? new Uint8Array(0);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }),
    text: jest.fn(async () => ''),
  } as unknown as Response;
}

describe('buildAnimeCoverPath', () => {
  it('builds the cover path for an anime id', () => {
    expect(buildAnimeCoverPath('anime-1')).toBe('/api/animes/anime-1/cover');
  });

  it('URL-encodes the anime id', () => {
    expect(buildAnimeCoverPath('a b/c')).toBe('/api/animes/a%20b%2Fc/cover');
  });
});

describe('classifyAnimeCoverResponse', () => {
  it('classifies 200 with a non-empty body as image', () => {
    expect(
      classifyAnimeCoverResponse({ status: 200, etag: '"abc"', retryAfterMs: null, byteLength: 10 }),
    ).toEqual({ kind: 'image', etag: '"abc"' });
  });

  it('classifies 200 with an empty body as transient', () => {
    expect(
      classifyAnimeCoverResponse({ status: 200, etag: null, retryAfterMs: null, byteLength: 0 }),
    ).toEqual({ kind: 'transient', status: 200, retryAfterMs: null });
  });

  it('classifies 304 as not_modified, carrying the etag', () => {
    expect(
      classifyAnimeCoverResponse({ status: 304, etag: '"abc"', retryAfterMs: null, byteLength: 0 }),
    ).toEqual({ kind: 'not_modified', etag: '"abc"' });
  });

  it('classifies 204 as absent', () => {
    expect(
      classifyAnimeCoverResponse({ status: 204, etag: null, retryAfterMs: null, byteLength: 0 }),
    ).toEqual({ kind: 'absent' });
  });

  it('classifies 404 as unknown', () => {
    expect(
      classifyAnimeCoverResponse({ status: 404, etag: null, retryAfterMs: null, byteLength: 0 }),
    ).toEqual({ kind: 'unknown' });
  });

  it('classifies 401 as unauthorized', () => {
    expect(
      classifyAnimeCoverResponse({ status: 401, etag: null, retryAfterMs: null, byteLength: 0 }),
    ).toEqual({ kind: 'unauthorized' });
  });

  it.each([503, 405, 500])('classifies %d as transient', (status) => {
    expect(
      classifyAnimeCoverResponse({ status, etag: null, retryAfterMs: 5_000, byteLength: 0 }),
    ).toEqual({ kind: 'transient', status, retryAfterMs: 5_000 });
  });
});

describe('BridgeClient.getAnimeCover', () => {
  it('returns image bytes and the verbatim quoted etag on 200', async () => {
    const bodyBytes = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
    const fetchFn = jest.fn(async () =>
      buildCoverResponse({ status: 200, headers: { ETag: '"deadbeef"' }, bodyBytes }),
    );
    const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const result = await client.getAnimeCover(CONNECTION, 'anime-1');

    expect(result.kind).toBe('image');
    if (result.kind === 'image') {
      expect(Array.from(result.bytes)).toEqual(Array.from(bodyBytes));
      expect(result.etag).toBe('"deadbeef"');
    }
  });

  it('sends If-None-Match verbatim when provided, and omits it otherwise', async () => {
    const fetchFn = jest.fn(async (_url: string, _init?: RequestInit) =>
      buildCoverResponse({ status: 304, headers: { ETag: '"abc"' } }),
    );
    const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch });

    await client.getAnimeCover(CONNECTION, 'anime-1', { ifNoneMatch: '"abc"' });

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['If-None-Match']).toBe('"abc"');

    fetchFn.mockClear();
    await client.getAnimeCover(CONNECTION, 'anime-1');

    const [, initNoTag] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((initNoTag.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
  });

  it('returns not_modified with the response etag on 304', async () => {
    const fetchFn = jest.fn(async () => buildCoverResponse({ status: 304, headers: { ETag: '"abc"' } }));
    const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const result = await client.getAnimeCover(CONNECTION, 'anime-1', { ifNoneMatch: '"abc"' });

    expect(result).toEqual({ kind: 'not_modified', etag: '"abc"' });
  });

  it('returns not_modified when response headers are unavailable', async () => {
    const response = { status: 304 } as Response;
    const client = createBridgeClient({
      fetchFn: jest.fn(async () => response) as unknown as typeof fetch,
    });

    await expect(client.getAnimeCover(CONNECTION, 'anime-1')).resolves.toEqual({
      kind: 'not_modified',
      etag: null,
    });
  });

  it('does not read response bytes for a non-200 status', async () => {
    const response = buildCoverResponse({ status: 503, headers: { 'Retry-After': '5' } });
    const client = createBridgeClient({
      fetchFn: jest.fn(async () => response) as unknown as typeof fetch,
    });

    await expect(client.getAnimeCover(CONNECTION, 'anime-1')).resolves.toEqual({
      kind: 'transient',
      status: 503,
      retryAfterMs: 5_000,
    });
    expect(response.arrayBuffer).not.toHaveBeenCalled();
  });

  it('returns absent on 204', async () => {
    const fetchFn = jest.fn(async () => buildCoverResponse({ status: 204 }));
    const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const result = await client.getAnimeCover(CONNECTION, 'anime-1');

    expect(result).toEqual({ kind: 'absent' });
  });

  it('returns unknown on 404', async () => {
    const fetchFn = jest.fn(async () => buildCoverResponse({ status: 404 }));
    const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const result = await client.getAnimeCover(CONNECTION, 'anime-1');

    expect(result).toEqual({ kind: 'unknown' });
  });

  it('returns unauthorized on 401', async () => {
    const fetchFn = jest.fn(async () => buildCoverResponse({ status: 401 }));
    const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const result = await client.getAnimeCover(CONNECTION, 'anime-1');

    expect(result).toEqual({ kind: 'unauthorized' });
  });

  it('returns transient with retryAfterMs converted from Retry-After: 5', async () => {
    const fetchFn = jest.fn(async () =>
      buildCoverResponse({ status: 503, headers: { 'Retry-After': '5' } }),
    );
    const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const result = await client.getAnimeCover(CONNECTION, 'anime-1');

    expect(result).toEqual({ kind: 'transient', status: 503, retryAfterMs: 5_000 });
  });

  it('returns transient with retryAfterMs null when Retry-After is absent', async () => {
    const fetchFn = jest.fn(async () => buildCoverResponse({ status: 503 }));
    const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const result = await client.getAnimeCover(CONNECTION, 'anime-1');

    expect(result).toEqual({ kind: 'transient', status: 503, retryAfterMs: null });
  });

  it('classifies 405 and 500 as transient', async () => {
    const client = createBridgeClient({
      fetchFn: jest.fn(async () => buildCoverResponse({ status: 405 })),
    });
    expect((await client.getAnimeCover(CONNECTION, 'anime-1')).kind).toBe('transient');

    const client2 = createBridgeClient({
      fetchFn: jest.fn(async () => buildCoverResponse({ status: 500 })),
    });
    expect((await client2.getAnimeCover(CONNECTION, 'anime-1')).kind).toBe('transient');
  });

  it('classifies a 200 with an empty body as transient', async () => {
    const fetchFn = jest.fn(async () => buildCoverResponse({ status: 200, bodyBytes: new Uint8Array(0) }));
    const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const result = await client.getAnimeCover(CONNECTION, 'anime-1');

    expect(result).toEqual({ kind: 'transient', status: 200, retryAfterMs: null });
  });

  it('always sends GET, never HEAD', async () => {
    const fetchFn = jest.fn(async (_url: string, _init?: RequestInit) => buildCoverResponse({ status: 204 }));
    const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch });

    await client.getAnimeCover(CONNECTION, 'anime-1');

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
  });

  it('URL-encodes the anime id in the request URL', async () => {
    const fetchFn = jest.fn(async (_url: string, _init?: RequestInit) => buildCoverResponse({ status: 204 }));
    const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch });

    await client.getAnimeCover(CONNECTION, 'a b');

    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://192.168.0.10:8080/api/animes/a%20b/cover');
  });

  it('sends a bearer Authorization header', async () => {
    const fetchFn = jest.fn(async (_url: string, _init?: RequestInit) => buildCoverResponse({ status: 204 }));
    const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch });

    await client.getAnimeCover(CONNECTION, 'anime-1');

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  });

  it('rejects with BridgeUnreachableError when the transport rejects', async () => {
    const fetchFn = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch });

    await expect(client.getAnimeCover(CONNECTION, 'anime-1')).rejects.toThrow(BridgeUnreachableError);
  });

  it('rejects with BridgeTimeoutError when the request exceeds the cover budget', async () => {
    jest.useFakeTimers();
    try {
      const fetchFn = jest.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      ) as unknown as typeof fetch;
      const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch });
      const pending = client.getAnimeCover(CONNECTION, 'anime-1');
      const assertion = pending.catch((error: unknown) => error);

      await jest.advanceTimersByTimeAsync(BRIDGE_COVER_REQUEST_TIMEOUT_MS);
      const error = await assertion;

      expect(error).toBeInstanceOf(BridgeTimeoutError);
      expect(error).toMatchObject({ timeoutMs: BRIDGE_COVER_REQUEST_TIMEOUT_MS });
    } finally {
      jest.useRealTimers();
    }
  });
});
