import { createRequestIdSequence } from '../../../src/features/sync/request-id.helpers';

/** The bridge contract's validation pattern for `X-Autoreas-Request-Id` (S1). */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,48}:[0-9]{1,9}$/;

/** A lowercase UUID, the shape every cycle id takes (S1, S4). */
const LOWERCASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('createRequestIdSequence', () => {
  it('mints a lowercase UUID cycle id and numbers its requests from 1 in order', () => {
    const sequence = createRequestIdSequence();

    expect(sequence.cycleId).toMatch(LOWERCASE_UUID_PATTERN);
    expect([sequence.next(), sequence.next(), sequence.next()]).toEqual([
      `${sequence.cycleId}:1`,
      `${sequence.cycleId}:2`,
      `${sequence.cycleId}:3`,
    ]);
  });

  it('produces ids the bridge contract accepts', () => {
    const sequence = createRequestIdSequence();

    for (let index = 0; index < 3; index += 1) {
      const requestId = sequence.next();

      expect(requestId).toMatch(REQUEST_ID_PATTERN);
      expect(requestId.length).toBeLessThanOrEqual(58);
    }
  });

  it('gives each cycle its own id and its own count', () => {
    const first = createRequestIdSequence();
    const second = createRequestIdSequence();

    first.next();
    first.next();

    expect(second.cycleId).not.toBe(first.cycleId);
    expect(second.next()).toBe(`${second.cycleId}:1`);
  });

  it('keeps an injected cycle id verbatim', () => {
    const sequence = createRequestIdSequence('cycle-7');

    expect(sequence.next()).toBe('cycle-7:1');
  });
});
