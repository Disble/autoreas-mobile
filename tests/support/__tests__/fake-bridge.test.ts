import { installFakeBridge } from '../fake-bridge.helpers';

describe('installFakeBridge', () => {
  afterEach(() => {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
  });

  it('records method, url, headers and parsed body for each request', async () => {
    const fakeBridge = installFakeBridge();
    fakeBridge.queueResponse({ status: 202, body: { status: 'accepted' } });

    await globalThis.fetch('https://bridge.local/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
      body: JSON.stringify({ device_id: 'device-1' }),
    });

    expect(fakeBridge.requests).toEqual([
      {
        method: 'POST',
        url: 'https://bridge.local/reconcile',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
        body: { device_id: 'device-1' },
      },
    ]);

    fakeBridge.restore();
  });

  it('replays queued responses in the order they were queued', async () => {
    const fakeBridge = installFakeBridge();
    fakeBridge.queueResponse({ status: 202, body: { status: 'first' } });
    fakeBridge.queueResponse({ status: 500, body: { status: 'second' } });

    const firstResponse = await globalThis.fetch('https://bridge.local/reconcile');
    const secondResponse = await globalThis.fetch('https://bridge.local/reconcile');

    expect(firstResponse.status).toBe(202);
    expect(firstResponse.ok).toBe(true);
    expect(await firstResponse.text()).toBe(JSON.stringify({ status: 'first' }));

    expect(secondResponse.status).toBe(500);
    expect(secondResponse.ok).toBe(false);
    expect(await secondResponse.text()).toBe(JSON.stringify({ status: 'second' }));

    fakeBridge.restore();
  });

  it('throws loudly naming the url when a request has nothing queued', async () => {
    const fakeBridge = installFakeBridge();

    await expect(globalThis.fetch('https://bridge.local/unqueued')).rejects.toThrow(
      /https:\/\/bridge\.local\/unqueued/,
    );

    fakeBridge.restore();
  });

  it('replays a queued response headers via a case-insensitive get (Decision 8)', async () => {
    const fakeBridge = installFakeBridge();
    fakeBridge.queueResponse({
      status: 503,
      body: { status: 'busy' },
      headers: { 'Retry-After': '120' },
    });

    const response = await globalThis.fetch('https://bridge.local/sync/diagnostics');

    expect(response.headers.get('Retry-After')).toBe('120');
    expect(response.headers.get('retry-after')).toBe('120');
    expect(response.headers.get('Missing-Header')).toBeNull();

    fakeBridge.restore();
  });

  it('still resolves without throwing when a queued response carries no headers', async () => {
    const fakeBridge = installFakeBridge();
    fakeBridge.queueResponse({ status: 200, body: { status: 'ok' } });

    await expect(globalThis.fetch('https://bridge.local/sync/diagnostics')).resolves.toBeDefined();

    fakeBridge.restore();
  });

  it('restore() returns globalThis.fetch to its previous value', () => {
    const originalFetch = globalThis.fetch;
    const fakeBridge = installFakeBridge();

    expect(globalThis.fetch).not.toBe(originalFetch);
    fakeBridge.restore();

    expect(globalThis.fetch).toBe(originalFetch);
  });
});
