import {
  BridgeUnreachableError,
  createBridgeClient,
} from '../../../src/infrastructure/api/bridge-client';

function buildResponse(overrides: Partial<{
  ok: boolean;
  status: number;
  body: string;
}> = {}) {
  const { ok = true, status = 200, body = '{}' } = overrides;
  return {
    ok,
    status,
    text: jest.fn(async () => body),
  };
}

describe('bridge-client', () => {
  const connection = { ip: '192.168.1.10', port: 8080, token: 'token123' };

  it('resolves the http base url and the websocket url from a connection', () => {
    const client = createBridgeClient();

    expect(client.resolveBaseUrl(connection)).toBe('http://192.168.1.10:8080');
    expect(client.resolveWebSocketUrl(connection)).toBe('ws://192.168.1.10:8080/ws');
  });

  it('lists animes with a bearer token and no content-type on a bodyless GET', async () => {
    const fetchFn = jest.fn(async () =>
      buildResponse({ body: JSON.stringify([{ _id: 'anime-1' }]) }) as unknown as Response,
    );
    const client = createBridgeClient({ fetchFn });

    const result = await client.listAnimes(connection);

    expect(fetchFn).toHaveBeenCalledWith('http://192.168.1.10:8080/api/animes', {
      method: 'GET',
      headers: { Authorization: 'Bearer token123' },
    });
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: [{ _id: 'anime-1' }],
      rawBody: JSON.stringify([{ _id: 'anime-1' }]),
      url: 'http://192.168.1.10:8080/api/animes',
    });
  });

  it('reconciles with content-type, bearer auth and a serialized body', async () => {
    const fetchFn = jest.fn(async () =>
      buildResponse({ status: 202, body: '{"status":"accepted"}' }) as unknown as Response,
    );
    const client = createBridgeClient({ fetchFn });

    const result = await client.reconcile(connection, { last_changelog_id: 0 });

    expect(fetchFn).toHaveBeenCalledWith('http://192.168.1.10:8080/api/sync/reconcile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token123',
      },
      body: JSON.stringify({ last_changelog_id: 0 }),
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);
    expect(result.data).toEqual({ status: 'accepted' });
  });

  it('pairs a device without an auth header and with the pairing contract body', async () => {
    const fetchFn = jest.fn(async () =>
      buildResponse({ status: 201, body: '{"device_id":"d1","auth_token":"a1"}' }) as unknown as Response,
    );
    const client = createBridgeClient({ fetchFn });

    await client.pairDevice(
      { ip: '192.168.1.10', port: 8080 },
      { pairingToken: 'pair-token', deviceName: 'AutoreasMobile' },
    );

    expect(fetchFn).toHaveBeenCalledWith('http://192.168.1.10:8080/api/devices/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairing_token: 'pair-token', device_name: 'AutoreasMobile' }),
    });
  });

  it('returns the raw body and a null payload when the response is not valid json', async () => {
    const fetchFn = jest.fn(async () =>
      buildResponse({ ok: false, status: 400, body: 'not-json' }) as unknown as Response,
    );
    const client = createBridgeClient({ fetchFn });

    const result = await client.reconcile(connection, {});

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.rawBody).toBe('not-json');
    expect(result.data).toBeNull();
  });

  it('throws a BridgeUnreachableError when the network request rejects', async () => {
    const fetchFn = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const client = createBridgeClient({ fetchFn });

    await expect(client.listAnimes(connection)).rejects.toBeInstanceOf(BridgeUnreachableError);
  });

  it('opens a websocket through the injected factory with the resolved url and token', () => {
    const socket = { close: jest.fn() } as unknown as WebSocket;
    const createWebSocket = jest.fn(() => socket);
    const client = createBridgeClient({ createWebSocket });

    const result = client.openWebSocket(connection);

    expect(createWebSocket).toHaveBeenCalledWith('ws://192.168.1.10:8080/ws', 'token123');
    expect(result).toBe(socket);
  });
});
