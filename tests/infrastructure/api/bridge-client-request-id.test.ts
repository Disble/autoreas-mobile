import { createBridgeClient } from '../../../src/infrastructure/api/bridge-client';
import { buildBridgeHeaders } from '../../../src/infrastructure/api/bridge-client/bridge-url.helpers';

/** The header every request of one sync cycle carries (S1). */
const REQUEST_ID_HEADER = 'X-Autoreas-Request-Id';

/** The paired bridge every request in this suite goes to. */
const connection = { ip: '192.168.1.10', port: 9876, token: 'token123' };

/** A successful reply; `headers` is attached only when given, like the header-less test doubles. */
function buildResponse(headers?: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    text: jest.fn(async () => '{}'),
    ...(headers ? { headers: { get: (name: string) => headers[name] ?? null } } : {}),
  } as unknown as Response;
}

/** The headers of the first request `fetchFn` received. */
function sentHeaders(fetchFn: jest.Mock): Record<string, string> {
  return (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
}

/** Builds a client over a fake transport and a recording logger. */
function buildClient(response: Response = buildResponse()) {
  const fetchFn = jest.fn(async () => response);
  const logger = { debug: jest.fn(), warn: jest.fn() };

  return { client: createBridgeClient({ fetchFn, logger }), fetchFn, logger };
}

describe('buildBridgeHeaders request id', () => {
  it('builds the previous headers exactly when no request id is given (S2)', () => {
    expect(buildBridgeHeaders({ token: 'token123', hasBody: true })).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token123',
    });
  });

  it('adds the request id header when one is given', () => {
    expect(buildBridgeHeaders({ token: 'token123', hasBody: false, requestId: 'cycle:1' })).toEqual({
      Authorization: 'Bearer token123',
      [REQUEST_ID_HEADER]: 'cycle:1',
    });
  });
});

describe('bridge client request id', () => {
  it.each([
    ['getAnime', (client: ReturnType<typeof createBridgeClient>) =>
      client.getAnime(connection, 'anime-1', { requestId: 'cycle:1' })],
    ['getActiveSeason', (client: ReturnType<typeof createBridgeClient>) =>
      client.getActiveSeason(connection, { requestId: 'cycle:1' })],
    ['postActiveSeasonRating', (client: ReturnType<typeof createBridgeClient>) =>
      client.postActiveSeasonRating(connection, { animeId: 'anime-1', nota: 4, ratedAt: 1 }, { requestId: 'cycle:1' })],
    ['reconcile', (client: ReturnType<typeof createBridgeClient>) =>
      client.reconcile(connection, { last_changelog_id: 0 }, { requestId: 'cycle:1' })],
    ['postSyncDiagnostics', (client: ReturnType<typeof createBridgeClient>) =>
      client.postSyncDiagnostics(connection, { kind: 'x' }, { requestId: 'cycle:1' })],
  ])('%s sends the request id it was given', async (_name, send) => {
    const { client, fetchFn } = buildClient();

    await send(client);

    expect(sentHeaders(fetchFn)[REQUEST_ID_HEADER]).toBe('cycle:1');
  });

  it('sends no request id header when the caller gives none (S2)', async () => {
    const { client, fetchFn } = buildClient();

    await client.getAnime(connection, 'anime-1');

    expect(sentHeaders(fetchFn)).toEqual({ Authorization: 'Bearer token123' });
  });

  it('logs the request id and the echoed one on the response line (S5)', async () => {
    const { client, logger } = buildClient(buildResponse({ [REQUEST_ID_HEADER]: 'cycle:1' }));

    await client.reconcile(connection, {}, { requestId: 'cycle:1' });

    expect(logger.debug).toHaveBeenCalledWith('[BridgeClient] response', {
      url: 'http://192.168.1.10:9876/api/sync/reconcile',
      method: 'POST',
      status: 200,
      requestId: 'cycle:1',
      echoedRequestId: 'cycle:1',
    });
  });

  it('keeps the response line unchanged for a request without an id', async () => {
    const { client, logger } = buildClient();

    await client.listAnimes(connection);

    expect(logger.debug).toHaveBeenCalledWith('[BridgeClient] response', {
      url: 'http://192.168.1.10:9876/api/animes',
      method: 'GET',
      status: 200,
    });
  });

  it('logs the request id when the request does not reach the bridge (S5)', async () => {
    const fetchFn = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const logger = { debug: jest.fn(), warn: jest.fn() };
    const client = createBridgeClient({ fetchFn, logger });

    await expect(client.getActiveSeason(connection, { requestId: 'cycle:2' })).rejects.toThrow();

    expect(logger.warn).toHaveBeenCalledWith('[BridgeClient] request did not reach the bridge', {
      url: 'http://192.168.1.10:9876/api/seasons/active',
      method: 'GET',
      requestId: 'cycle:2',
    });
  });

  it('logs the request id when the request exceeds its budget (S5)', async () => {
    jest.useFakeTimers();
    try {
      const fetchFn = jest.fn((_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }));
      const logger = { debug: jest.fn(), warn: jest.fn() };
      const client = createBridgeClient({ fetchFn: fetchFn as unknown as typeof fetch, logger });

      const pending = client.reconcile(connection, {}, { timeoutMs: 5, requestId: 'cycle:3' });
      const assertion = expect(pending).rejects.toThrow();
      await jest.advanceTimersByTimeAsync(5);
      await assertion;

      expect(logger.warn).toHaveBeenCalledWith('[BridgeClient] request exceeded its budget', {
        url: 'http://192.168.1.10:9876/api/sync/reconcile',
        method: 'POST',
        timeoutMs: 5,
        requestId: 'cycle:3',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
