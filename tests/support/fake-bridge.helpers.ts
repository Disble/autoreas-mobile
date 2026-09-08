import type {
  FakeBridge,
  FakeBridgeRequest,
  QueuedBridgeResponse,
} from './fake-bridge.types';

/**
 * Parses a `fetch` init body back into the value the caller serialized, so assertions read
 * `{ device_id: 'device-1' }` rather than a JSON string. A non-JSON body is recorded verbatim.
 */
function parseRequestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') {
    return body ?? undefined;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

/**
 * Synthesizes a minimal case-insensitive `Headers.get` off a queued response's optional header
 * map (Decision 8). Returns `undefined` when no map was queued, so the replayed `Response` stub
 * carries no `headers` property at all -- preserving the exact header-less double shape that
 * `bridge-client.helpers.ts`'s defensive read exists to survive.
 */
function buildQueuedHeadersGetter(
  headers: Record<string, string> | undefined,
): { get: (name: string) => string | null } | undefined {
  if (!headers) {
    return undefined;
  }

  const lowered = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));

  return {
    get: (name: string) => lowered.get(name.toLowerCase()) ?? null,
  };
}

/**
 * Substitutes `globalThis.fetch` with a programmable double (design D4). This is the ONLY seam
 * the behaviour suite fakes: `resolveFetch()` in the bridge client falls back to the global, and
 * the shared `bridgeClient` singleton is built with no injected transport, so replacing the
 * global substitutes the wire for the very client feature code imports -- no module mock, and no
 * divergence between what a test exercises and what ships.
 *
 * A request with nothing queued throws and names the url. Returning a default `200` instead
 * would let a test pass while exercising a call nobody meant to make.
 */
export function installFakeBridge(): FakeBridge {
  const previousFetch = globalThis.fetch;
  const requests: FakeBridgeRequest[] = [];
  const queued: QueuedBridgeResponse[] = [];

  const fakeFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input);

    requests.push({
      method: init?.method ?? 'GET',
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: parseRequestBody(init?.body),
    });

    const next = queued.shift();

    if (!next) {
      return Promise.reject(
        new Error(
          `tests/support/fake-bridge: no response queued for ${url}. Queue one with ` +
            'queueResponse() -- an unqueued request is a call the test did not intend.',
        ),
      );
    }

    const rawBody = JSON.stringify(next.body);
    const headers = buildQueuedHeadersGetter(next.headers);

    return Promise.resolve({
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: () => Promise.resolve(rawBody),
      ...(headers ? { headers } : {}),
    } as unknown as Response);
  };

  (globalThis as { fetch: typeof fetch }).fetch = fakeFetch as unknown as typeof fetch;

  return {
    requests,
    queueResponse(response: QueuedBridgeResponse) {
      queued.push(response);
    },
    restore() {
      (globalThis as { fetch: typeof fetch }).fetch = previousFetch;
    },
  };
}
