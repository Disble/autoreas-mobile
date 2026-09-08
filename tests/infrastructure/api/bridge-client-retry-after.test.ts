import { createBridgeClient } from '../../../src/infrastructure/api/bridge-client';
import { SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS } from '../../../src/infrastructure/api/bridge-client/bridge-client.constants';
import { parseRetryAfterMs } from '../../../src/infrastructure/api/bridge-client/bridge-url.helpers';

/** The paired bridge every case in this file talks to. */
const CONNECTION = { ip: '192.168.0.10', port: 8080, token: 'token-1' };

describe('BridgeClient retryAfterMs -- defensive header read (Decision 8)', () => {
  it('does not throw and yields retryAfterMs: null against a header-less Response double', async () => {
    // Exactly today's `tests/support/fake-bridge.helpers.ts` stub shape: `ok`, `status`, `text`,
    // and NO `headers` property. This is the regression guard for the verified breakage in
    // Decision 8 -- an unguarded `response.headers.get(...)` throws against this exact shape.
    const fetchFn = jest.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          text: () => Promise.resolve('{}'),
        }) as unknown as Response,
    );
    const client = createBridgeClient({ fetchFn });

    const result = await client.listAnimes(CONNECTION);

    expect(result.retryAfterMs).toBeNull();
  });

  it('reads Retry-After off a real headers.get when the double provides one', async () => {
    const fetchFn = jest.fn(
      async () =>
        ({
          ok: false,
          status: 503,
          text: () => Promise.resolve('{}'),
          headers: { get: (name: string) => (name === 'Retry-After' ? '120' : null) },
        }) as unknown as Response,
    );
    const client = createBridgeClient({ fetchFn });

    const result = await client.listAnimes(CONNECTION);

    expect(result.retryAfterMs).toBe(120_000);
  });
});

describe('parseRetryAfterMs (Decision 2)', () => {
  const NOW = 1_700_000_000_000;

  it('parses delta-seconds per RFC 9110 SS10.2.3', () => {
    expect(parseRetryAfterMs('120', NOW)).toBe(120_000);
    expect(parseRetryAfterMs('0', NOW)).toBe(0);
  });

  it('parses an HTTP-date in the future as the remaining ms, clamped at zero', () => {
    const future = new Date(NOW + 5_000).toUTCString();

    expect(parseRetryAfterMs(future, NOW)).toBe(5_000);
  });

  it('opens the gate immediately for an HTTP-date already in the past', () => {
    const past = new Date(NOW - 5_000).toUTCString();

    expect(parseRetryAfterMs(past, NOW)).toBe(0);
  });

  it.each([
    ['absent', null],
    ['empty', ''],
    ['negative', '-5'],
    ['fractional', '1.5'],
    ['an unparseable word', 'soon'],
  ])('returns null, never a zero-with-meaning, for a %s value', (_label, raw) => {
    expect(parseRetryAfterMs(raw, NOW)).toBeNull();
  });

  it('clamps an accepted value above the cap to SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS', () => {
    const secondsAboveCap = String(SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS / 1_000 + 100);

    expect(parseRetryAfterMs(secondsAboveCap, NOW)).toBe(SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS);
  });

  it('never misreads "2000" as a year-2000 date -- the strict delta-seconds branch must run first', () => {
    expect(parseRetryAfterMs('2000', NOW)).toBe(2_000_000);
  });
});
