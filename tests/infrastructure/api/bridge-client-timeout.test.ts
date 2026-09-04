import {
  BridgeTimeoutError,
  BridgeUnreachableError,
  createBridgeClient,
} from '../../../src/infrastructure/api/bridge-client';
import { BRIDGE_REQUEST_TIMEOUT_MS } from '../../../src/infrastructure/api/bridge-client/bridge-client.constants';

/** The paired bridge every case in this file talks to. */
const CONNECTION = { ip: '192.168.0.10', port: 8080, token: 'token-1' };

/** Builds a `fetch` double that never settles unless its signal aborts. */
function hangingFetch() {
  const calls: RequestInit[] = [];

  const fetchFn = ((_url: string, init?: RequestInit) => {
    calls.push(init ?? {});

    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });
  }) as unknown as typeof fetch;

  return { calls, fetchFn };
}

describe('BridgeClient request timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('passes an AbortSignal on every request', async () => {
    const { calls, fetchFn } = hangingFetch();
    const client = createBridgeClient({ fetchFn });
    const pending = client.listAnimes(CONNECTION);
    const assertion = expect(pending).rejects.toThrow(BridgeTimeoutError);

    await jest.advanceTimersByTimeAsync(BRIDGE_REQUEST_TIMEOUT_MS);
    await assertion;

    expect(calls[0].signal).toBeDefined();
  });

  it('aborts a hung request at the default timeout and reports it as a timeout', async () => {
    const { fetchFn } = hangingFetch();
    const client = createBridgeClient({ fetchFn });
    const pending = client.reconcile(CONNECTION, { device_id: 'device-1' });
    const assertion = pending.catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(BRIDGE_REQUEST_TIMEOUT_MS);
    const error = await assertion;

    expect(error).toBeInstanceOf(BridgeTimeoutError);
    expect(error).toMatchObject({ timeoutMs: BRIDGE_REQUEST_TIMEOUT_MS });
  });

  it('stays pending until the deadline actually elapses', async () => {
    const { fetchFn } = hangingFetch();
    const client = createBridgeClient({ fetchFn });
    let settled = false;
    const pending = client.listAnimes(CONNECTION).catch(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(BRIDGE_REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });

  it('classifies a timeout as unreachable, so existing retry logic keeps working', async () => {
    const { fetchFn } = hangingFetch();
    const client = createBridgeClient({ fetchFn });
    const pending = client.listAnimes(CONNECTION);
    const assertion = pending.catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(BRIDGE_REQUEST_TIMEOUT_MS);
    const error = await assertion;

    // Two call sites branch on `instanceof BridgeUnreachableError` to treat a failure as
    // transient: season-rating-queue.helpers.ts and sync-connection-store.helpers.ts. A timeout
    // IS "did not reach the bridge" and IS transient, so subclassing keeps both correct with no
    // call-site edit. A sibling class would silently reclassify every timeout as permanent.
    expect(error).toBeInstanceOf(BridgeUnreachableError);
  });

  it('clears the timeout when a response arrives in time', async () => {
    const fetchFn = (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{}'),
      })) as unknown as typeof fetch;
    const client = createBridgeClient({ fetchFn });

    const result = await client.listAnimes(CONNECTION);

    expect(result.status).toBe(200);
    // A timer left armed per request would keep the host runtime alive after the cycle ends.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears the timeout when the transport fails before the deadline', async () => {
    const fetchFn = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;
    const client = createBridgeClient({ fetchFn });

    await expect(client.listAnimes(CONNECTION)).rejects.toThrow(BridgeUnreachableError);

    expect(jest.getTimerCount()).toBe(0);
  });

  it('honours a per-request timeout override', async () => {
    const { fetchFn } = hangingFetch();
    const client = createBridgeClient({ fetchFn });
    const pending = client.reconcile(CONNECTION, {}, { timeoutMs: 250 });
    const assertion = pending.catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(250);
    const error = await assertion;

    expect(error).toMatchObject({ timeoutMs: 250 });
  });
});
